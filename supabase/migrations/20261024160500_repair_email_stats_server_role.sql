-- Run after transactional email outbox/statistics migrations.
-- Keep statistics accessible to service-role functions only, without relying
-- on JWT GUCs that were absent in production PostgREST calls.
CREATE OR REPLACE FUNCTION public.email_delivery_statistics()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'private'
AS $function$
declare result jsonb;
begin
  if current_setting('role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  select jsonb_build_object(
    'pending',count(*) filter (where j.status='pending'),
    'processing',count(*) filter (where j.status='processing'),
    'sent',count(*) filter (where j.status='sent'),
    'failed',count(*) filter (where j.status='failed'),
    'quarantined',count(*) filter (where j.status='failed'
      and j.last_error like 'Manual reconciliation required:%'
      and (r.decision is null or r.decision='needs_investigation')),
    'reviewed_cases',count(*) filter (where j.status='failed'
      and j.last_error like 'Manual reconciliation required:%'
      and r.decision in ('provider_delivery_confirmed','provider_not_sent_confirmed','closed_no_retry')),
    'suppressed',count(*) filter (where j.status='suppressed'),
    'sent_last_24h',count(*) filter (where j.sent_at > now()-interval '24 hours'),
    'oldest_pending_at',min(j.created_at) filter (where j.status='pending'),
    'delivered',count(*) filter (where j.delivery_state='delivered'),
    'provider_failed',count(*) filter (where j.delivery_state in ('hard_bounce','spam','blocked','invalid')),
    'awaiting_delivery_confirmation',count(*) filter (where j.status='sent' and j.delivery_state='unconfirmed'),
    'total',count(*)
  ) into result from private.email_jobs j
  left join lateral (
    select a.decision from private.email_review_actions a
    where a.job_id=j.id order by a.id desc limit 1
  ) r on true;
  return result;
end $function$
;
REVOKE ALL ON FUNCTION public.email_delivery_statistics() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.email_delivery_statistics() TO service_role;
NOTIFY pgrst,'reload schema';
