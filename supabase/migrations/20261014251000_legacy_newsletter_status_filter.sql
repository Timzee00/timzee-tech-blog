-- Aggregate-only audit of preexisting dormant accounts.
-- Never produces email addresses, grants marketing consent, or queues emails.
-- Legacy last_sign_in_at is only a proxy for engagement, not guaranteed absence.
create or replace function public.legacy_user_recovery_overview()
returns jsonb language plpgsql security definer
set search_path to pg_catalog,private,public
as $body$
declare stats jsonb;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role'
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
end $body$;
revoke all on function public.legacy_user_recovery_overview() from public,anon,authenticated;
grant execute on function public.legacy_user_recovery_overview() to service_role;
