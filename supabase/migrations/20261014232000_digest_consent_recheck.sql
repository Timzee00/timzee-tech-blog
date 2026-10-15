-- Re-check digest consent immediately before sending. Never infer consent from in-app alerts.
create or replace function public.check_digest_consent(p_email text,p_template text)
returns boolean language plpgsql stable security definer
set search_path to pg_catalog,private,public
as $body$
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'service_role' then
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
end $body$;
revoke all on function public.check_digest_consent(text,text) from public,anon,authenticated;
grant execute on function public.check_digest_consent(text,text) to service_role;

-- If a user opts out, clear unsent optional digest jobs for their own email.
create or replace function private.cancel_opted_out_digest_jobs()
returns trigger language plpgsql security definer
set search_path to pg_catalog,private,public
as $body$
declare address text;
begin
  select lower(trim(u.email)) into address from auth.users u where u.id=new.user_id;
  if address is null then return new; end if;
  update private.email_jobs j
  set status='suppressed',lease_until=null,
      last_error='Digest category disabled in account email settings',
      updated_at=now()
  where j.status='pending' and j.recipient_email=address and
    ((j.template='message_digest' and not new.message_digest)
    or (j.template='mention_digest' and not new.mention_digest)
    or (j.template='marketplace_alerts' and not new.marketplace_alerts)
    or (j.template='community_digest' and not new.community_digest));
  return new;
end $body$;
revoke all on function private.cancel_opted_out_digest_jobs() from public,anon,authenticated;
drop trigger if exists email_prefs_cancel_unwanted_jobs on public.email_notification_preferences;
create trigger email_prefs_cancel_unwanted_jobs
after update on public.email_notification_preferences
for each row execute function private.cancel_opted_out_digest_jobs();
