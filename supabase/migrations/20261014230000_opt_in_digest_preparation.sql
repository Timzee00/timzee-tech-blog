-- Prepare optional digests only for verified, active, explicitly opted-in users.
-- This installs no cron and defaults dispatch to OFF. Email delivery remains separately gated.
alter table private.email_jobs drop constraint if exists email_jobs_template_check;
alter table private.email_jobs add constraint email_jobs_template_check
  check (template in (
    'contact_received','support_received','advertising_received',
    'message_digest','mention_digest','marketplace_alerts','community_digest'
  ));

create table if not exists private.email_digest_controls (
  singleton boolean primary key default true check(singleton),
  enabled boolean not null default false,
  daily_job_cap integer not null default 20 check(daily_job_cap between 1 and 100),
  updated_at timestamptz not null default now()
);
insert into private.email_digest_controls(singleton,enabled,daily_job_cap)
values(true,false,20) on conflict(singleton) do nothing;
alter table private.email_digest_controls enable row level security;
revoke all on private.email_digest_controls from public,anon,authenticated;
grant select on private.email_digest_controls to service_role;

create index if not exists notifications_digest_unread_idx
  on public.notifications(user_id,created_at desc)
  where read_at is null;

create or replace function public.prepare_email_digests(
  p_dry_run boolean default true,
  p_limit integer default 10
)
returns jsonb language plpgsql security definer
set search_path to pg_catalog,private,public
as $body$
declare
  dispatch_enabled boolean;
  daily_cap integer;
  remaining integer;
  candidates integer := 0;
  inserted integer := 0;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  select enabled,daily_job_cap into dispatch_enabled,daily_cap
  from private.email_digest_controls where singleton=true;
  if not coalesce(dispatch_enabled,false) and not p_dry_run then
    return jsonb_build_object('enabled',false,'dry_run',false,'eligible',0,'enqueued',0);
  end if;
  select greatest(0,coalesce(daily_cap,20)-count(*)::integer) into remaining
  from private.email_jobs
  where template in ('message_digest','mention_digest','marketplace_alerts','community_digest')
    and created_at >= now()-interval '24 hours';

  -- Temporary bounded staging result for deterministic candidate selection.
  create temporary table if not exists digest_candidate_work (
    user_id uuid,template text,recipient_email text,item_count integer
  ) on commit drop;
  truncate table digest_candidate_work;

  insert into digest_candidate_work(user_id,template,recipient_email,item_count)
  select n.user_id,
    case
      when lower(coalesce(nullif(n.notification_type,''),nullif(n.type,''),'')) ~ '(message|chat)' then 'message_digest'
      when lower(coalesce(nullif(n.notification_type,''),nullif(n.type,''),'')) ~ '(mention|reply|comment)' then 'mention_digest'
      when lower(coalesce(nullif(n.notification_type,''),nullif(n.type,''),'')) ~ '(market|inquir|listing|order)' then 'marketplace_alerts'
      when lower(coalesce(nullif(n.notification_type,''),nullif(n.type,''),'')) ~ '(follow|community|discussion|announcement)' then 'community_digest'
      else null
    end as template,
    lower(trim(u.email)) as recipient_email,
    count(*)::integer as item_count
  from public.notifications n
  join public.email_notification_preferences p on p.user_id=n.user_id
  join auth.users u on u.id=n.user_id
  join public.profiles pr on pr.id=n.user_id
  where n.read_at is null and n.created_at >= (now() at time zone 'utc')-interval '24 hours'
    and u.email_confirmed_at is not null
    and nullif(trim(coalesce(u.email,'')),'') is not null
    and pr.account_status='active'
    and not exists (select 1 from private.email_suppressions es where es.email=lower(trim(u.email)))
    and (
      (p.message_digest and lower(coalesce(nullif(n.notification_type,''),nullif(n.type,''),'')) ~ '(message|chat)')
      or (p.mention_digest and lower(coalesce(nullif(n.notification_type,''),nullif(n.type,''),'')) ~ '(mention|reply|comment)')
      or (p.marketplace_alerts and lower(coalesce(nullif(n.notification_type,''),nullif(n.type,''),'')) ~ '(market|inquir|listing|order)')
      or (p.community_digest and lower(coalesce(nullif(n.notification_type,''),nullif(n.type,''),'')) ~ '(follow|community|discussion|announcement)')
    )
  group by n.user_id,template,lower(trim(u.email))
  having count(*)>0;

  delete from digest_candidate_work c where c.template is null or exists (
    select 1 from private.email_jobs j
    where j.recipient_email=c.recipient_email and j.template=c.template
      and j.created_at > now()-interval '24 hours'
  );
  select count(*) into candidates from digest_candidate_work;
  if p_dry_run then
    return jsonb_build_object('enabled',coalesce(dispatch_enabled,false),
      'dry_run',true,'eligible',candidates,'enqueued',0,'remaining_budget',remaining);
  end if;
  -- Serialize dispatch across concurrent invocations to respect the pilot quota.
  perform pg_advisory_xact_lock(77091421);
  select greatest(0,coalesce(daily_cap,20)-count(*)::integer) into remaining
  from private.email_jobs
  where template in ('message_digest','mention_digest','marketplace_alerts','community_digest')
    and created_at >= now()-interval '24 hours';

  with chosen as (
    select c.* from digest_candidate_work c
    order by c.user_id,c.template
    limit least(greatest(coalesce(p_limit,10),1),20,remaining)
  ), queued as (
    insert into private.email_jobs(event_key,template,recipient_email,payload)
    select 'digest:'||c.template||':'||c.user_id::text||':'||to_char(now() at time zone 'utc','YYYYMMDD'),
      c.template,c.recipient_email,
      jsonb_build_object('count',least(c.item_count,9999))
    from chosen c
    on conflict(event_key) do nothing
    returning id
  )
  select count(*) into inserted from queued;
  return jsonb_build_object('enabled',true,'dry_run',false,'eligible',candidates,'enqueued',inserted);
end $body$;
revoke all on function public.prepare_email_digests(boolean,integer) from public,anon,authenticated;
grant execute on function public.prepare_email_digests(boolean,integer) to service_role;
