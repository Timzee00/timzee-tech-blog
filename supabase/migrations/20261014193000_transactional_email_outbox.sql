-- Transactional email outbox. Commit in same transaction as a request.
-- Private data never exposed through the browser Data API.
create schema if not exists private;
create table if not exists private.email_jobs (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  template text not null check (template in ('contact_received','support_received','advertising_received')),
  recipient_email text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','sent','failed','suppressed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  lease_until timestamptz,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists email_jobs_claim_idx on private.email_jobs(status,next_attempt_at,created_at)
  where status in ('pending','processing');
create index if not exists email_jobs_created_idx on private.email_jobs(created_at desc);
revoke all on schema private from public,anon,authenticated;
revoke all on private.email_jobs from public,anon,authenticated;
grant usage on schema private to service_role;
grant select,update,insert on private.email_jobs to service_role;

create or replace function private.enqueue_public_receipt()
returns trigger language plpgsql security definer
set search_path to pg_catalog, public, private as $$
declare
  kind text;
begin
  if tg_table_name = 'contact_requests' then kind := 'contact_received';
  elsif tg_table_name = 'support_requests' then kind := 'support_received';
  elsif tg_table_name = 'ad_applications' then kind := 'advertising_received';
  else return new;
  end if;
  if nullif(trim(new.email),'') is null then return new; end if;
  insert into private.email_jobs(event_key,template,recipient_email,payload)
  values (
    kind || ':' || new.id::text,
    kind,
    lower(trim(new.email)),
    jsonb_build_object('reference',new.id::text,'name',left(coalesce(new.name,''),120))
  ) on conflict (event_key) do nothing;
  return new;
end $$;
revoke all on function private.enqueue_public_receipt() from public,anon,authenticated;
drop trigger if exists enqueue_contact_email on public.contact_requests;
create trigger enqueue_contact_email after insert on public.contact_requests
for each row execute function private.enqueue_public_receipt();
drop trigger if exists enqueue_support_email on public.support_requests;
create trigger enqueue_support_email after insert on public.support_requests
for each row execute function private.enqueue_public_receipt();
drop trigger if exists enqueue_advertising_email on public.ad_applications;
create trigger enqueue_advertising_email after insert on public.ad_applications
for each row execute function private.enqueue_public_receipt();

create or replace function private.claim_email_jobs(p_limit integer default 20)
returns setof private.email_jobs language plpgsql security definer
set search_path to pg_catalog,private as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
  return query
  with claimed as (
    select id from private.email_jobs
    where (status='pending' and next_attempt_at <= now())
       or (status='processing' and lease_until < now())
    order by created_at asc
    for update skip locked limit least(greatest(p_limit,1),50)
  )
  update private.email_jobs j set status='processing',attempts=j.attempts+1,
    lease_until=now()+interval '4 minutes',updated_at=now()
  from claimed c where j.id=c.id returning j.*;
end $$;
revoke all on function private.claim_email_jobs(integer) from public,anon,authenticated;
grant execute on function private.claim_email_jobs(integer) to service_role;

create or replace function private.complete_email_job(p_id uuid,p_success boolean,p_provider_id text default null,p_error text default null)
returns void language plpgsql security definer
set search_path to pg_catalog,private as $$
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden'; end if;
  update private.email_jobs
  set status=case when p_success then 'sent' when attempts>=6 then 'failed' else 'pending' end,
      sent_at=case when p_success then now() else sent_at end,
      provider_message_id=case when p_success then left(p_provider_id,200) else provider_message_id end,
      last_error=case when p_success then null else left(coalesce(p_error,'Delivery failed'),500) end,
      next_attempt_at=case when p_success then next_attempt_at
        else now()+ (interval '1 minute' * least(240, power(2,least(attempts,8))::int)) end,
      lease_until=null,updated_at=now()
  where id=p_id and status='processing';
end $$;
revoke all on function private.complete_email_job(uuid,boolean,text,text) from public,anon,authenticated;
grant execute on function private.complete_email_job(uuid,boolean,text,text) to service_role;
