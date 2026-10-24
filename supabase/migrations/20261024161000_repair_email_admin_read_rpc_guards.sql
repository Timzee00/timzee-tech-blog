-- Targeted fix for the remaining read-only super-admin dashboard RPCs.
-- Keep SQL EXECUTE exclusive to service_role; do not expose private metrics to clients.
CREATE OR REPLACE FUNCTION public.list_email_review_cases(p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
declare result jsonb;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at asc), '[]'::jsonb)
  into result from (
    select j.id,j.template,j.attempts,j.created_at,j.updated_at,
           j.delivery_state,
           left(coalesce(j.last_error,''),220) as reason,
           coalesce(review.decision,'unreviewed') as last_decision,
           review.reviewed_at
    from private.email_jobs j
    left join lateral (
      select decision,reviewed_at
      from private.email_review_actions a
      where a.job_id=j.id
      order by a.id desc limit 1
    ) review on true
    where j.status='failed'
      and j.last_error like 'Manual reconciliation required:%'
      and (review.decision is null or review.decision='needs_investigation')
    order by j.created_at asc
    limit least(greatest(coalesce(p_limit,25),1),50)
  ) t;
  return result;
end $function$
;
REVOKE ALL ON FUNCTION public.list_email_review_cases(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.list_email_review_cases(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.legacy_user_recovery_overview()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private', 'public'
AS $function$
declare stats jsonb;
begin
  if current_setting('role',true) is distinct from 'service_role'
  then raise exception 'forbidden'; end if;
  with members as (
    select u.id,
           u.email_confirmed_at is not null as confirmed,
           coalesce(v.last_seen_at,u.last_sign_in_at,u.created_at) as last_activity_proxy,
           v.user_id is not null as has_visit_signal,
           exists(
             select 1 from public.newsletter_signups n
             where lower(trim(n.email))=lower(trim(u.email))
               and n.consent_at is not null
               and lower(coalesce(n.status,'')) not in ('unsubscribed','revoked','suppressed','spam','bounced')
           ) as newsletter_consent_recorded,
           coalesce(p.inactivity_reminders,false) as reminder_opted_in
    from auth.users u
    left join private.user_visit_activity v on v.user_id=u.id
    left join public.email_notification_preferences p on p.user_id=u.id
    where u.deleted_at is null
  )
  select jsonb_build_object(
    'total_members',count(*),
    'email_confirmed',count(*) filter(where confirmed),
    'no_recent_activity_30d',count(*) filter(where confirmed and last_activity_proxy<now()-interval '30 days'),
    'no_recent_activity_60d',count(*) filter(where confirmed and last_activity_proxy<now()-interval '60 days'),
    'no_recent_activity_90d',count(*) filter(where confirmed and last_activity_proxy<now()-interval '90 days'),
    'has_visit_tracking',count(*) filter(where has_visit_signal),
    'documented_newsletter_consent',count(*) filter(where confirmed and newsletter_consent_recorded),
    'documented_newsletter_and_inactive_30d',count(*) filter(where confirmed and newsletter_consent_recorded and last_activity_proxy<now()-interval '30 days'),
    'inactivity_reminder_opted_in',count(*) filter(where confirmed and reminder_opted_in),
    'legacy_inactivity_email_authorized',0,
    'emails_queued',0,
    'proxy_notice','Historic last sign-in does not capture sessions or anonymous visits. Newsletter consent is not inactivity-reminder consent.'
  )
  into stats from members;
  return stats;
end $function$
;
REVOKE ALL ON FUNCTION public.legacy_user_recovery_overview() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.legacy_user_recovery_overview() TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_inactivity_reminders(p_dry_run boolean DEFAULT true, p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private', 'public'
AS $function$
declare flag boolean; days_threshold integer; quota integer;
declare eligible integer := 0; used integer; created integer := 0;
begin
  if current_setting('role',true) is distinct from 'service_role' then
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
end $function$
;
REVOKE ALL ON FUNCTION public.prepare_inactivity_reminders(boolean,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_inactivity_reminders(boolean,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.prepare_email_digests(p_dry_run boolean DEFAULT true, p_limit integer DEFAULT 10)
 RETURNS jsonb
 LANGUAGE plpgsql
 STRICT SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private', 'public'
AS $function$
declare
  dispatch_enabled boolean;
  daily_cap integer;
  remaining integer;
  candidates integer := 0;
  inserted integer := 0;
begin
  if current_setting('role',true) is distinct from 'service_role' then
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

  with classified as (
    select n.user_id,
      case
        when lower(coalesce(nullif(n.notification_type,''),nullif(n.type,''),'')) ~ '(message|chat)' then 'message_digest'
        when lower(coalesce(nullif(n.notification_type,''),nullif(n.type,''),'')) ~ '(mention|reply|comment)' then 'mention_digest'
        when lower(coalesce(nullif(n.notification_type,''),nullif(n.type,''),'')) ~ '(market|inquir|listing|order)' then 'marketplace_alerts'
        when lower(coalesce(nullif(n.notification_type,''),nullif(n.type,''),'')) ~ '(follow|community|discussion|announcement)' then 'community_digest'
        else null
      end as kind
    from public.notifications n
    where n.read_at is null
      and n.created_at >= (now() at time zone 'utc')-interval '24 hours'
  )
  insert into digest_candidate_work(user_id,template,recipient_email,item_count)
  select n.user_id,n.kind,lower(trim(u.email)),count(*)::integer
  from classified n
  join public.email_notification_preferences p on p.user_id=n.user_id
  join auth.users u on u.id=n.user_id
  join public.profiles pr on pr.id=n.user_id
  where u.email_confirmed_at is not null
    and nullif(trim(coalesce(u.email,'')),'') is not null
    and pr.account_status='active'
    and not exists (select 1 from private.email_suppressions es where es.email=lower(trim(u.email)))
    and (
      (n.kind='message_digest' and p.message_digest)
      or (n.kind='mention_digest' and p.mention_digest)
      or (n.kind='marketplace_alerts' and p.marketplace_alerts)
      or (n.kind='community_digest' and p.community_digest)
    )
  group by n.user_id,n.kind,lower(trim(u.email))
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
end $function$
;
REVOKE ALL ON FUNCTION public.prepare_email_digests(boolean,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.prepare_email_digests(boolean,integer) TO service_role;

NOTIFY pgrst,'reload schema';
