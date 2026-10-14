-- Transactional status outcomes for existing staff-managed workflows.
-- Never email user-provided messages, moderation notes or verification documents.
alter table private.email_jobs drop constraint if exists email_jobs_template_check;
alter table private.email_jobs add constraint email_jobs_template_check
  check (template in (
    'contact_received','support_received','advertising_received',
    'message_digest','mention_digest','marketplace_alerts','community_digest',
    'support_status','advertising_status','verification_status','report_status'
  ));
create or replace function private.enqueue_workflow_status_email()
returns trigger language plpgsql security definer
set search_path to pg_catalog,private,public
as $body$
declare template_key text;
declare address text;
declare next_status text;
declare safe_id text;
begin
  if new.status is not distinct from old.status then return new; end if;
  next_status := lower(trim(coalesce(new.status,'')));
  if next_status not in ('approved','rejected','resolved','completed','closed','dismissed','cancelled','under_review','in_review') then
    return new;
  end if;
  if tg_table_name='support_requests' then
    template_key:='support_status'; address:=lower(trim(coalesce(new.email,'')));
  elsif tg_table_name='ad_applications' then
    template_key:='advertising_status'; address:=lower(trim(coalesce(new.email,'')));
  elsif tg_table_name='verification_applications' then
    template_key:='verification_status';
    select lower(trim(u.email)) into address from auth.users u
    where u.id=new.user_id and u.email_confirmed_at is not null;
  elsif tg_table_name='content_reports' then
    template_key:='report_status';
    select lower(trim(u.email)) into address from auth.users u
    where u.id=new.reporter_id and u.email_confirmed_at is not null;
  else
    return new;
  end if;
  if address is null or address !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
      or length(address)>320 then return new; end if;
  if exists(select 1 from private.email_suppressions s where s.email=address) then return new; end if;
  -- Hard cap applies to pilot public/system transactional email volume.
  perform pg_advisory_xact_lock(77091422);
  if (select count(*) from private.email_jobs where created_at>now()-interval '24 hours')>=180
  then return new; end if;
  safe_id:=new.id::text;
  insert into private.email_jobs(event_key,template,recipient_email,payload)
  values('workflow:'||template_key||':'||safe_id||':'||next_status,
    template_key,address,jsonb_build_object('reference',safe_id,'status',next_status))
  on conflict(event_key) do nothing;
  return new;
end $body$;
revoke all on function private.enqueue_workflow_status_email() from public,anon,authenticated;
drop trigger if exists email_support_status on public.support_requests;
create trigger email_support_status after update of status on public.support_requests
for each row execute function private.enqueue_workflow_status_email();
drop trigger if exists email_ad_status on public.ad_applications;
create trigger email_ad_status after update of status on public.ad_applications
for each row execute function private.enqueue_workflow_status_email();
drop trigger if exists email_verification_status on public.verification_applications;
create trigger email_verification_status after update of status on public.verification_applications
for each row execute function private.enqueue_workflow_status_email();
drop trigger if exists email_report_status on public.content_reports;
create trigger email_report_status after update of status on public.content_reports
for each row execute function private.enqueue_workflow_status_email();
