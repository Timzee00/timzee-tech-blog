-- Journal delivery outcomes separately from provider acceptance.
-- Additive migration; does not change existing automatic sending or its kill switch.
alter table private.email_jobs
  add column if not exists delivery_state text not null default 'unconfirmed'
    check (delivery_state in ('unconfirmed','delivered','hard_bounce','soft_bounce','spam','blocked','invalid')),
  add column if not exists delivered_at timestamptz;

create index if not exists email_jobs_provider_message_idx
  on private.email_jobs(provider_message_id)
  where provider_message_id is not null;

create table if not exists private.email_provider_events(
  id bigint generated always as identity primary key,
  event_key text not null unique,
  provider text not null default 'brevo',
  provider_message_id text not null,
  event_name text not null check(event_name in ('delivered','hard_bounce','soft_bounce','spam','blocked','invalid','deferred')),
  event_time timestamptz not null,
  recorded_at timestamptz not null default now()
);
create index if not exists email_provider_events_message_idx
  on private.email_provider_events(provider_message_id,event_time desc);
create index if not exists email_provider_events_recent_idx
  on private.email_provider_events(recorded_at desc);
alter table private.email_provider_events enable row level security;
revoke all on private.email_provider_events from public,anon,authenticated;
grant select,insert on private.email_provider_events to service_role;

create or replace function public.record_brevo_delivery_event(
  p_event text,
  p_email text,
  p_message_id text default null,
  p_event_epoch bigint default null
)
returns jsonb language plpgsql security definer
set search_path to pg_catalog,private,public
as $body$
declare
  event_kind text := lower(trim(coalesce(p_event,'')));
  address text := lower(trim(coalesce(p_email,'')));
  mid text := trim(both '<>' from trim(coalesce(p_message_id,'')));
  event_ts timestamptz := now();
  inserted_count integer := 0;
  matched_count integer := 0;
  is_suppression boolean := false;
  fingerprint text;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if event_kind not in ('delivered','hard_bounce','soft_bounce','spam','blocked','invalid','deferred') then
    return jsonb_build_object('handled',false,'reason','event_not_tracked');
  end if;
  if length(address) > 320 or address !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$' then
    return jsonb_build_object('handled',false,'reason','invalid_recipient');
  end if;
  if p_event_epoch between 1514764800 and 4102444800 then
    event_ts := to_timestamp(p_event_epoch);
  end if;
  -- Do not suppress for transient soft bounce/deferred events.
  is_suppression := event_kind in ('hard_bounce','spam','blocked','invalid');
  if is_suppression then
    insert into private.email_suppressions(email,reason)
      values(address,event_kind)
      on conflict(email) do update set reason=excluded.reason,updated_at=now();
    update private.email_jobs set status='suppressed',lease_until=null,
      last_error='Recipient suppressed after provider failure',updated_at=now()
      where recipient_email=address and status='pending';
  end if;

  -- Retain only message-level metadata, never message content or recipient email.
  if mid <> '' and length(mid) <= 255 then
    fingerprint := md5('brevo:'||mid||':'||event_kind||':'||event_ts::text||':'||address);
    insert into private.email_provider_events(event_key,provider_message_id,event_name,event_time)
    values(fingerprint,mid,event_kind,event_ts)
    on conflict(event_key) do nothing;
    get diagnostics inserted_count = row_count;

    update private.email_jobs j
    set delivery_state=case
        when event_kind='delivered' and j.delivery_state not in ('hard_bounce','spam','blocked','invalid') then 'delivered'
        when event_kind in ('hard_bounce','spam','blocked','invalid') then event_kind
        when event_kind='soft_bounce' and j.delivery_state='unconfirmed' then 'soft_bounce'
        else j.delivery_state
      end,
      delivered_at=case
        when event_kind='delivered' and j.delivery_state not in ('hard_bounce','spam','blocked','invalid')
          then event_ts else j.delivered_at
      end,
      updated_at=now()
    where j.provider_message_id=mid and j.recipient_email=address;
    get diagnostics matched_count = row_count;
  end if;
  return jsonb_build_object('handled',true,'suppressed',is_suppression,
    'recorded',inserted_count>0,'matched_jobs',matched_count);
end $body$;
revoke all on function public.record_brevo_delivery_event(text,text,text,bigint) from public,anon,authenticated;
grant execute on function public.record_brevo_delivery_event(text,text,text,bigint) to service_role;

-- A provider webhook may arrive before the worker records Brevo's message ID.
-- Reconcile prior outcomes on job completion to avoid losing such events.
create or replace function public.complete_email_job(
 p_id uuid,p_success boolean,p_provider_id text default null,p_error text default null
)
returns void language plpgsql security definer
set search_path to pg_catalog,private
as $body$
declare
  recent_event record;
  mid text := trim(both '<>' from trim(coalesce(p_provider_id,'')));
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  update private.email_jobs
  set status=case when p_success then 'sent' when attempts>=6 then 'failed' else 'pending' end,
      sent_at=case when p_success then now() else sent_at end,
      provider_message_id=case when p_success then left(mid,255) else provider_message_id end,
      last_error=case when p_success then null else left(coalesce(p_error,'Delivery failed'),500) end,
      next_attempt_at=case when p_success then next_attempt_at
        else now()+interval '1 minute'*least(240,power(2,least(attempts,8))::int) end,
      lease_until=null,updated_at=now()
  where id=p_id and status='processing';

  if p_success and mid <> '' then
    select e.event_name,e.event_time into recent_event
    from private.email_provider_events e
    where e.provider_message_id=mid and e.event_name in
      ('delivered','hard_bounce','spam','blocked','invalid')
    order by
      case when e.event_name in ('spam','hard_bounce','blocked','invalid') then 0 else 1 end,
      e.event_time desc
    limit 1;
    if found then
      update private.email_jobs
      set delivery_state=recent_event.event_name,
        delivered_at=case when recent_event.event_name='delivered'
          then recent_event.event_time else delivered_at end,
        updated_at=now()
      where id=p_id;
    end if;
  end if;
end $body$;
revoke all on function public.complete_email_job(uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function public.complete_email_job(uuid,boolean,text,text) to service_role;

create or replace function public.email_delivery_statistics()
returns jsonb language plpgsql security definer set search_path to pg_catalog,private
as $body$
declare result jsonb;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
  then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'pending', count(*) filter (where status='pending'),
    'processing', count(*) filter (where status='processing'),
    'sent', count(*) filter (where status='sent'),
    'failed', count(*) filter (where status='failed'),
    'suppressed', count(*) filter (where status='suppressed'),
    'sent_last_24h', count(*) filter (where sent_at > now()-interval '24 hours'),
    'oldest_pending_at', min(created_at) filter (where status='pending'),
    'delivered',count(*) filter(where delivery_state='delivered'),
    'provider_failed',count(*) filter(where delivery_state in ('hard_bounce','spam','blocked','invalid')),
    'awaiting_delivery_confirmation',count(*) filter(where status='sent' and delivery_state='unconfirmed'),
    'total',count(*)
  ) into result from private.email_jobs;
  return result;
end $body$;
revoke all on function public.email_delivery_statistics() from public,anon,authenticated;
grant execute on function public.email_delivery_statistics() to service_role;
