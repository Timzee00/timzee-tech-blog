-- A one-click email opt-out may only disable the matching member's opt-in.
-- Token verification happens at the Netlify boundary; this RPC binds it to a queued job.
create or replace function public.opt_out_inactivity_from_email(
  p_user_id uuid,p_job_id uuid
) returns boolean language plpgsql security definer
set search_path to pg_catalog,private,public
as $body$
declare matches_job boolean;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
    raise exception 'forbidden';
  end if;
  select exists(
    select 1 from private.email_jobs j
    where j.id=p_job_id and j.template='inactivity_reminder'
      and j.payload->>'user_id'=p_user_id::text
  ) into matches_job;
  if matches_job is distinct from true then return false; end if;
  update public.email_notification_preferences
  set inactivity_reminders=false,updated_at=now()
  where user_id=p_user_id;
  -- Trigger cancels unsent reminders; direct defense for all pending jobs.
  update private.email_jobs j set status='suppressed',
    last_error='Member used opt-out link',lease_until=null,updated_at=now()
  where j.template='inactivity_reminder' and j.status='pending'
    and j.payload->>'user_id'=p_user_id::text;
  return true;
end $body$;
revoke all on function public.opt_out_inactivity_from_email(uuid,uuid) from public,anon,authenticated;
grant execute on function public.opt_out_inactivity_from_email(uuid,uuid) to service_role;
