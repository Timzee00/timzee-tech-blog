-- One opt-in reminder for each 30-day absence, never for existing users by default.
alter table public.email_notification_preferences
  add column if not exists inactivity_reminders boolean not null default false,
  add column if not exists inactivity_opted_in_at timestamptz;

create or replace function private.stamp_inactivity_opt_in()
returns trigger language plpgsql set search_path to pg_catalog,private
as $body$
begin
  if new.inactivity_reminders and (tg_op='INSERT' or not old.inactivity_reminders) then
    new.inactivity_opted_in_at:=now();
  elsif not new.inactivity_reminders then
    new.inactivity_opted_in_at:=null;
  end if;
  return new;
end $body$;
revoke all on function private.stamp_inactivity_opt_in() from public,anon,authenticated;
drop trigger if exists email_inactivity_opt_in_stamp on public.email_notification_preferences;
create trigger email_inactivity_opt_in_stamp
before insert or update of inactivity_reminders on public.email_notification_preferences
for each row execute function private.stamp_inactivity_opt_in();

create table if not exists private.user_visit_activity(
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  last_reminded_visit_at timestamptz,
  updated_at timestamptz not null default now()
);
create index if not exists visit_activity_inactive_idx
  on private.user_visit_activity(last_seen_at)
  where last_reminded_visit_at is null or last_reminded_visit_at < last_seen_at;
alter table private.user_visit_activity enable row level security;
revoke all on private.user_visit_activity from public,anon,authenticated;
grant select,insert,update on private.user_visit_activity to service_role;

-- Authenticated members can update ONLY their own visit time, at most once per 6 h.
create or replace function public.record_my_site_visit()
returns boolean language plpgsql security definer
set search_path to pg_catalog,private
as $body$
declare uid uuid := (select auth.uid());
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'authenticated' or uid is null then
    return false;
  end if;
  insert into private.user_visit_activity(user_id,last_seen_at,updated_at)
  values(uid,now(),now())
  on conflict(user_id) do update set
    last_seen_at=excluded.last_seen_at,updated_at=excluded.updated_at
  where private.user_visit_activity.last_seen_at <= now()-interval '6 hours';
  return true;
end $body$;
revoke all on function public.record_my_site_visit() from public,anon,authenticated;
grant execute on function public.record_my_site_visit() to authenticated;

-- Do not send reminders to users who have not explicitly opted in.
alter table private.email_jobs drop constraint if exists email_jobs_template_check;
alter table private.email_jobs add constraint email_jobs_template_check
  check (template in (
    'contact_received','support_received','advertising_received',
    'message_digest','mention_digest','marketplace_alerts','community_digest',
    'support_status','advertising_status','verification_status','report_status',
    'inactivity_reminder'
  ));

create table if not exists private.inactivity_campaign_controls(
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  inactive_after_days integer not null default 30 check(inactive_after_days between 21 and 180),
  daily_cap integer not null default 10 check(daily_cap between 1 and 100),
  updated_at timestamptz not null default now()
);
insert into private.inactivity_campaign_controls(singleton,enabled,inactive_after_days,daily_cap)
values(true,false,30,10) on conflict(singleton) do nothing;
alter table private.inactivity_campaign_controls enable row level security;
revoke all on private.inactivity_campaign_controls from public,anon,authenticated;
grant select on private.inactivity_campaign_controls to service_role;

create or replace function public.prepare_inactivity_reminders(
 p_dry_run boolean default true,p_limit integer default 10
)
returns jsonb language plpgsql security definer
set search_path to pg_catalog,private,public
as $body$
declare flag boolean; days_threshold integer; quota integer;
declare eligible integer := 0; used integer; created integer := 0;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  select enabled,inactive_after_days,daily_cap into flag,days_threshold,quota
  from private.inactivity_campaign_controls where singleton;
  if not p_dry_run and coalesce(flag,false)=false then
    return jsonb_build_object('enabled',false,'dry_run',false,'eligible',0,'enqueued',0);
  end if;
  -- Serialize preparation under one advisory lock, including quota calculation.
  if not p_dry_run then perform pg_advisory_xact_lock(77091424); end if;
  select count(*) into used from private.email_jobs
  where template='inactivity_reminder' and created_at>now()-interval '24 hours';

  create temporary table if not exists inactive_candidate_work(
    user_id uuid,recipient_email text,last_seen_at timestamptz
  ) on commit drop;
  truncate table inactive_candidate_work;
  insert into inactive_candidate_work(user_id,recipient_email,last_seen_at)
  select a.user_id,lower(trim(u.email)),a.last_seen_at
  from private.user_visit_activity a
  join auth.users u on u.id=a.user_id
  join public.profiles pr on pr.id=a.user_id
  join public.email_notification_preferences p on p.user_id=a.user_id
  where p.inactivity_reminders=true
    and p.inactivity_opted_in_at is not null
    and a.last_seen_at >= p.inactivity_opted_in_at
    and a.last_seen_at < now()-make_interval(days=>coalesce(days_threshold,30))
    and (a.last_reminded_visit_at is null or a.last_reminded_visit_at < a.last_seen_at)
    and pr.account_status='active' and u.email_confirmed_at is not null
    and u.banned_until is null
    and u.email is not null
    and not exists(select 1 from private.email_suppressions s where s.email=lower(trim(u.email)))
    and not exists(select 1 from private.email_jobs j
      where j.template='inactivity_reminder' and j.event_key=
        'inactive:'||a.user_id::text||':'||to_char(a.last_seen_at at time zone 'utc','YYYYMMDDHH24MISS'))
  order by a.last_seen_at asc
  limit 250;
  select count(*) into eligible from inactive_candidate_work;
  if p_dry_run then return jsonb_build_object('enabled',coalesce(flag,false),'dry_run',true,'eligible',eligible,
    'enqueued',0,'remaining_budget',greatest(0,coalesce(quota,10)-used)); end if;

  with selected as (
    select c.* from inactive_candidate_work c
    order by c.last_seen_at asc,c.user_id
    limit least(greatest(coalesce(p_limit,10),1),20,greatest(0,coalesce(quota,10)-used))
  ), jobs as (
    insert into private.email_jobs(event_key,template,recipient_email,payload)
    select 'inactive:'||c.user_id::text||':'||to_char(c.last_seen_at at time zone 'utc','YYYYMMDDHH24MISS'),
      'inactivity_reminder',c.recipient_email,
      jsonb_build_object('last_seen_at',c.last_seen_at,'user_id',c.user_id)
    from selected c on conflict(event_key) do nothing
    returning payload
  ), marked as (
    update private.user_visit_activity a
    set last_reminded_visit_at=(j.payload->>'last_seen_at')::timestamptz,updated_at=now()
    from jobs j
    where a.user_id=(j.payload->>'user_id')::uuid
      and a.last_seen_at=(j.payload->>'last_seen_at')::timestamptz
    returning a.user_id
  )
  select count(*) into created from marked;
  return jsonb_build_object('enabled',true,'dry_run',false,'eligible',eligible,'enqueued',created);
end $body$;
revoke all on function public.prepare_inactivity_reminders(boolean,integer) from public,anon,authenticated;
grant execute on function public.prepare_inactivity_reminders(boolean,integer) to service_role;
