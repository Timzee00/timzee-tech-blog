-- Expose only aggregate reconciliation counts, never recipient addresses.
create or replace function public.email_delivery_statistics()
returns jsonb language plpgsql security definer
set search_path to pg_catalog,private
as $body$
declare result jsonb;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  select jsonb_build_object(
    'pending',count(*) filter (where status='pending'),
    'processing',count(*) filter (where status='processing'),
    'sent',count(*) filter (where status='sent'),
    'failed',count(*) filter (where status='failed'),
    'quarantined',count(*) filter (
      where status='failed' and last_error like 'Manual reconciliation required:%'),
    'suppressed',count(*) filter (where status='suppressed'),
    'sent_last_24h',count(*) filter (where sent_at > now()-interval '24 hours'),
    'oldest_pending_at',min(created_at) filter (where status='pending'),
    'delivered',count(*) filter (where delivery_state='delivered'),
    'provider_failed',count(*) filter (where delivery_state in ('hard_bounce','spam','blocked','invalid')),
    'awaiting_delivery_confirmation',count(*) filter (where status='sent' and delivery_state='unconfirmed'),
    'total',count(*)
  ) into result from private.email_jobs;
  return result;
end $body$;
revoke all on function public.email_delivery_statistics() from public,anon,authenticated;
grant execute on function public.email_delivery_statistics() to service_role;
