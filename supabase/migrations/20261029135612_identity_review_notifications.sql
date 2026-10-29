-- Notifications stay server-owned and are sent only after an actual
-- reviewed assignment or invitation transition, never on page loads.
create or replace function private.identity_change_notify()
returns trigger language plpgsql security definer set search_path=pg_catalog,public,private as $$
declare event_kind text; title text; body text; recipient uuid;
begin
 recipient:=new.user_id;
 if tg_table_name='identity_affiliations' then
  if tg_op='INSERT' and new.status='pending' or
    tg_op='UPDATE' and old.status is distinct from new.status then
    if new.status='pending' then
      event_kind:='affiliation_invite';title:='Organization affiliation invitation';
      body:='A verified organization has invited you to connect your account. Review it in About this account.';
    elsif new.status='active' then
      event_kind:='affiliation_confirmed';title:='Company affiliation confirmed';
      body:='Your approved organization affiliation is now visible on your profile.';
    elsif new.status='revoked' then
      event_kind:='affiliation_revoked';title:='Organization affiliation ended';
      body:='An organization affiliation on your account has ended.';
    end if;
  end if;
 elsif tg_table_name='identity_appointments' then
  if tg_op='INSERT' or new.status is distinct from old.status then
    if new.status='active' then
      event_kind:='advisor_appointment';title:='Blipmood appointment approved';
      body:='You have received a reviewed Blipmood appointment: '||replace(new.role_code,'_',' ')||'.';
    elsif new.status='revoked' then
      event_kind:='appointment_revoked';title:='Blipmood appointment updated';
      body:='One of your Blipmood appointments has ended.';
    end if;
  end if;
 elsif tg_table_name='identity_awards' then
  if tg_op='INSERT' and new.is_active then
    event_kind:='recognition_awarded';title:='You earned Blipmood recognition';
    body:='Blipmood has recognized your contribution: '||replace(new.award_code,'_',' ')||'.';
  elsif tg_op='UPDATE' and old.is_active and not new.is_active then
    event_kind:='recognition_revoked';title:='Blipmood recognition updated';
    body:='A previous Blipmood recognition has been withdrawn.';
  end if;
 elsif tg_table_name='identity_advisor_applications' then
  if tg_op='UPDATE' and old.status='pending' and new.status in ('approved','rejected') then
    event_kind:='advisor_decision';title:='Blipmood Advisor application reviewed';
    body:='Your Advisor application was '||new.status||'. View your application history for details.';
  end if;
 end if;
 if event_kind is not null then
  perform public.emit_user_notification(recipient,event_kind,title,body,
    case when tg_table_name='identity_advisor_applications' then '/advisor.html'
         else '/profile.html?id='||recipient::text end,
    jsonb_build_object('identity_action',event_kind,'record_id',new.id));
 end if;
 return new;
end $$;
revoke all on function private.identity_change_notify() from public,anon,authenticated;

drop trigger if exists identity_affiliation_notify on public.identity_affiliations;
create trigger identity_affiliation_notify after insert or update of status on public.identity_affiliations
for each row execute function private.identity_change_notify();
drop trigger if exists identity_appointments_notify on public.identity_appointments;
create trigger identity_appointments_notify after insert or update of status on public.identity_appointments
for each row execute function private.identity_change_notify();
drop trigger if exists identity_awards_notify on public.identity_awards;
create trigger identity_awards_notify after insert or update of is_active on public.identity_awards
for each row execute function private.identity_change_notify();
drop trigger if exists identity_advisor_reviews_notify on public.identity_advisor_applications;
create trigger identity_advisor_reviews_notify after update of status on public.identity_advisor_applications
for each row execute function private.identity_change_notify();