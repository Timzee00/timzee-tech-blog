-- Stop automated retries when Brevo may have accepted a message.
-- Human reconciliation is required because provider idempotency has a bounded TTL.
create or replace function public.quarantine_email_job(
  p_id uuid,
  p_reason text default 'Provider delivery outcome uncertain'
)
returns boolean language plpgsql security definer
set search_path to pg_catalog,private
as $body$
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
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
end $body$;
revoke all on function public.quarantine_email_job(uuid,text) from public,anon,authenticated;
grant execute on function public.quarantine_email_job(uuid,text) to service_role;
