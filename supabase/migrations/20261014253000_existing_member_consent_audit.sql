-- Consent capture for existing members who actively opt into future check-ins.
-- No backfill of older accounts and no email campaign or scheduled send.
create table if not exists private.email_preference_audit (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check(category in ('message_digest','mention_digest','marketplace_alerts','community_digest','inactivity_reminders')),
  enabled boolean not null,
  recorded_at timestamptz not null default now()
);
create index if not exists email_preference_audit_user_idx
  on private.email_preference_audit(user_id, recorded_at desc);
alter table private.email_preference_audit enable row level security;
revoke all on private.email_preference_audit from public, anon, authenticated;
grant select on private.email_preference_audit to service_role;

-- Protect the server-set opt-in timestamp from forged client writes to the row.
create or replace function private.stamp_inactivity_opt_in()
returns trigger language plpgsql security definer
set search_path to pg_catalog,private,public
as $body$
begin
  if tg_op='INSERT' then
    if new.inactivity_reminders then
      new.inactivity_opted_in_at=now();
      insert into private.user_visit_activity(user_id,last_seen_at,updated_at)
      values(new.user_id,now(),now())
      on conflict(user_id) do update set last_seen_at=excluded.last_seen_at,updated_at=now();
    else
      new.inactivity_opted_in_at=null;
    end if;
  elsif new.inactivity_reminders is distinct from old.inactivity_reminders then
    if new.inactivity_reminders then
      new.inactivity_opted_in_at=now();
      insert into private.user_visit_activity(user_id,last_seen_at,updated_at)
      values(new.user_id,now(),now())
      on conflict(user_id) do update set last_seen_at=excluded.last_seen_at,updated_at=now();
    else
      new.inactivity_opted_in_at=null;
      update private.email_jobs j
      set status='suppressed',last_error='Member opted out of inactivity reminders',
          lease_until=null,updated_at=now()
      where j.status='pending' and j.template='inactivity_reminder'
        and j.payload->>'user_id'=new.user_id::text;
    end if;
  else
    new.inactivity_opted_in_at=old.inactivity_opted_in_at;
  end if;
  return new;
end $body$;
revoke all on function private.stamp_inactivity_opt_in() from public,anon,authenticated;
drop trigger if exists email_inactivity_opt_in_stamp on public.email_notification_preferences;
create trigger email_inactivity_opt_in_stamp
before insert or update on public.email_notification_preferences
for each row execute function private.stamp_inactivity_opt_in();

create or replace function private.audit_member_email_preferences()
returns trigger language plpgsql security definer
set search_path to pg_catalog,private
as $body$
declare pref text; before_flag boolean; after_flag boolean;
begin
  foreach pref in array array[
    'message_digest','mention_digest','marketplace_alerts','community_digest','inactivity_reminders'
  ] loop
    after_flag=coalesce((to_jsonb(new)->>pref)::boolean,false);
    if tg_op='INSERT' then before_flag=false;
    else before_flag=coalesce((to_jsonb(old)->>pref)::boolean,false); end if;
    if after_flag is distinct from before_flag then
      insert into private.email_preference_audit(user_id,category,enabled)
      values(new.user_id,pref,after_flag);
    end if;
  end loop;
  return new;
end $body$;
revoke all on function private.audit_member_email_preferences() from public,anon,authenticated;
drop trigger if exists email_member_preference_audit on public.email_notification_preferences;
create trigger email_member_preference_audit
after insert or update on public.email_notification_preferences
for each row execute function private.audit_member_email_preferences();

-- Purpose-specific, account-owned action: does not touch any other email switches.
create or replace function public.enable_my_inactivity_reminders()
returns boolean language plpgsql security definer
set search_path to pg_catalog,private,public
as $body$
declare uid uuid := (select auth.uid());
begin
  if current_setting('request.jwt.claim.role',true) is distinct from 'authenticated'
     or uid is null then return false; end if;
  insert into public.email_notification_preferences(user_id,inactivity_reminders,updated_at)
  values(uid,true,now())
  on conflict (user_id) do update
    set inactivity_reminders=true,updated_at=now()
    where public.email_notification_preferences.inactivity_reminders is distinct from true;
  return true;
end $body$;
revoke all on function public.enable_my_inactivity_reminders() from public,anon,authenticated;
grant execute on function public.enable_my_inactivity_reminders() to authenticated;
