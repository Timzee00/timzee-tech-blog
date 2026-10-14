-- Send-time safety for workflow outcomes and voluntary re-engagement email.
create or replace function public.can_send_workflow_status(
  p_template text,p_reference text,p_status text,p_email text
) returns boolean language plpgsql stable security definer
set search_path to pg_catalog,private,public
as $body$
declare ref uuid; status_expected text:=lower(trim(coalesce(p_status,'')));
declare address text:=lower(trim(coalesce(p_email,'')));
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
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
end $body$;
revoke all on function public.can_send_workflow_status(text,text,text,text) from public,anon,authenticated;
grant execute on function public.can_send_workflow_status(text,text,text,text) to service_role;

create or replace function public.can_send_inactivity_reminder(
  p_email text,p_user_id uuid,p_visit_at timestamptz
) returns boolean language plpgsql stable security definer
set search_path to pg_catalog,private,public
as $body$
declare threshold integer;
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
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
end $body$;
revoke all on function public.can_send_inactivity_reminder(text,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.can_send_inactivity_reminder(text,uuid,timestamptz) to service_role;

-- Consent toggling is a genuine signed-in visit, preventing stale historic eligibility.
create or replace function private.stamp_inactivity_opt_in()
returns trigger language plpgsql security definer
set search_path to pg_catalog,private,public
as $body$
begin
  if new.inactivity_reminders and (tg_op='INSERT' or not old.inactivity_reminders) then
    new.inactivity_opted_in_at:=now();
    insert into private.user_visit_activity(user_id,last_seen_at,updated_at)
    values(new.user_id,now(),now())
    on conflict(user_id) do update set last_seen_at=excluded.last_seen_at,updated_at=now();
  elsif not new.inactivity_reminders then
    new.inactivity_opted_in_at:=null;
    -- Never dispatch an unsent reminder after an opt-out.
    update private.email_jobs j set status='suppressed',
      last_error='Member opted out of inactivity reminders',lease_until=null,updated_at=now()
    where j.status='pending' and j.template='inactivity_reminder'
      and j.payload->>'user_id'=new.user_id::text;
  end if;
  return new;
end $body$;
revoke all on function private.stamp_inactivity_opt_in() from public,anon,authenticated;
