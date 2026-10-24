-- Unify server-only email RPC authorization with PostgreSQL role checking.
-- Each function remains EXECUTE-only for service_role; dashboard and worker
-- must authenticate users or scheduled invocations independently.
CREATE OR REPLACE FUNCTION public.can_send_workflow_status(p_template text, p_reference text, p_status text, p_email text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private', 'public'
AS $function$
declare ref uuid; status_expected text:=lower(trim(coalesce(p_status,'')));
declare address text:=lower(trim(coalesce(p_email,'')));
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_reference is null or p_reference !~* '^[0-9a-f-]{36}$' then return false; end if;
  ref:=p_reference::uuid;
  if p_template='support_status' then
    return exists(select 1 from public.support_requests t where t.id=ref
      and lower(trim(t.status))=status_expected and lower(trim(t.email))=address);
  elsif p_template='advertising_status' then
    return exists(select 1 from public.ad_applications t where t.id=ref
      and lower(trim(t.status))=status_expected and lower(trim(t.email))=address);
  elsif p_template='verification_status' then
    return exists(select 1 from public.verification_applications t join auth.users u on u.id=t.user_id
      where t.id=ref and lower(trim(t.status))=status_expected
      and lower(trim(u.email))=address and u.email_confirmed_at is not null);
  elsif p_template='report_status' then
    return exists(select 1 from public.content_reports t join auth.users u on u.id=t.reporter_id
      where t.id=ref and lower(trim(t.status))=status_expected
      and lower(trim(u.email))=address and u.email_confirmed_at is not null);
  end if;
  return false;
exception when invalid_text_representation then return false;
end $function$
;
REVOKE ALL ON FUNCTION public.can_send_workflow_status(text,text,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_send_workflow_status(text,text,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.check_digest_consent(p_email text, p_template text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private', 'public'
AS $function$
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_template not in ('message_digest','mention_digest','marketplace_alerts','community_digest') then
    return false;
  end if;
  return exists (
    select 1 from auth.users u
    join public.profiles pr on pr.id=u.id
    join public.email_notification_preferences p on p.user_id=u.id
    where lower(trim(u.email))=lower(trim(coalesce(p_email,'')))
      and u.email_confirmed_at is not null and pr.account_status='active'
      and (
        (p_template='message_digest' and p.message_digest)
        or (p_template='mention_digest' and p.mention_digest)
        or (p_template='marketplace_alerts' and p.marketplace_alerts)
        or (p_template='community_digest' and p.community_digest)
      )
      and not exists (select 1 from private.email_suppressions s
        where s.email=lower(trim(u.email)))
  );
end $function$
;
REVOKE ALL ON FUNCTION public.check_digest_consent(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_digest_consent(text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.claim_email_jobs(p_limit integer DEFAULT 20)
 RETURNS SETOF private.email_jobs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
begin
  if current_setting('role',true) is distinct from 'service_role' then raise exception 'forbidden'; end if;
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
end $function$
;
REVOKE ALL ON FUNCTION public.claim_email_jobs(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_email_jobs(integer) TO service_role;

CREATE OR REPLACE FUNCTION public.complete_email_job(p_id uuid, p_success boolean, p_provider_id text DEFAULT NULL::text, p_error text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
declare
  recent_event record;
  mid text := trim(both '<>' from trim(coalesce(p_provider_id,'')));
begin
  if current_setting('role',true) is distinct from 'service_role' then
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
end $function$
;
REVOKE ALL ON FUNCTION public.complete_email_job(uuid,boolean,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.complete_email_job(uuid,boolean,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.is_email_suppressed(p_email text)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  return exists(select 1 from private.email_suppressions where email=lower(trim(coalesce(p_email,''))));
end $function$
;
REVOKE ALL ON FUNCTION public.is_email_suppressed(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_email_suppressed(text) TO service_role;

CREATE OR REPLACE FUNCTION public.quarantine_email_job(p_id uuid, p_reason text DEFAULT 'Provider delivery outcome uncertain'::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  update private.email_jobs
  set status='failed',
      last_error='Manual reconciliation required: '||left(coalesce(p_reason,'uncertain'),350),
      lease_until=null,
      next_attempt_at='infinity'::timestamptz,
      updated_at=now()
  where id=p_id and status='processing';
  return found;
end $function$
;
REVOKE ALL ON FUNCTION public.quarantine_email_job(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quarantine_email_job(uuid,text) TO service_role;

CREATE OR REPLACE FUNCTION public.record_email_review_action(p_job_id uuid, p_actor_id uuid, p_decision text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
declare
 current_review text;
 is_quarantined boolean;
 review_id bigint;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  if p_actor_id is null or p_decision not in (
    'needs_investigation','provider_delivery_confirmed','provider_not_sent_confirmed','closed_no_retry'
  ) or length(trim(coalesce(p_note,''))) not between 15 and 1000 then
    raise exception 'Invalid review decision or note';
  end if;
  select j.status='failed' and j.last_error like 'Manual reconciliation required:%'
  into is_quarantined
  from private.email_jobs j where j.id=p_job_id for update;
  if not found or is_quarantined is distinct from true then
    raise exception 'Job is not awaiting manual reconciliation';
  end if;
  select decision into current_review
  from private.email_review_actions where job_id=p_job_id order by id desc limit 1;
  if current_review is not null and current_review <> 'needs_investigation' then
    raise exception 'Case is already closed';
  end if;
  insert into private.email_review_actions(job_id,actor_id,decision,note)
  values(p_job_id,p_actor_id,p_decision,trim(p_note)) returning id into review_id;
  return jsonb_build_object('review_id',review_id,'decision',p_decision,'sent',false);
end $function$
;
REVOKE ALL ON FUNCTION public.record_email_review_action(uuid,uuid,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_email_review_action(uuid,uuid,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.suppress_email_job(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  update private.email_jobs set status='suppressed',last_error='Recipient is suppressed',
    lease_until=null,updated_at=now()
  where id=p_id and status='processing';
  return found;
end $function$
;
REVOKE ALL ON FUNCTION public.suppress_email_job(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.suppress_email_job(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.can_send_inactivity_reminder(p_email text, p_user_id uuid, p_visit_at timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private', 'public'
AS $function$
declare threshold integer;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  select inactive_after_days into threshold from private.inactivity_campaign_controls where singleton;
  return exists(
    select 1 from private.user_visit_activity a
    join public.email_notification_preferences p on p.user_id=a.user_id
    join public.profiles pr on pr.id=a.user_id
    join auth.users u on u.id=a.user_id
    where a.user_id=p_user_id
      and a.last_seen_at=p_visit_at
      and a.last_seen_at < now()-make_interval(days=>coalesce(threshold,30))
      and a.last_reminded_visit_at=p_visit_at
      and p.inactivity_reminders=true
      and p.inactivity_opted_in_at is not null
      and a.last_seen_at >= p.inactivity_opted_in_at
      and pr.account_status='active' and u.email_confirmed_at is not null
      and lower(trim(u.email))=lower(trim(coalesce(p_email,'')))
      and not exists(select 1 from private.email_suppressions s where s.email=lower(trim(u.email)))
  );
end $function$
;
REVOKE ALL ON FUNCTION public.can_send_inactivity_reminder(text,uuid,timestamp with time zone) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.can_send_inactivity_reminder(text,uuid,timestamp with time zone) TO service_role;

NOTIFY pgrst,'reload schema';
