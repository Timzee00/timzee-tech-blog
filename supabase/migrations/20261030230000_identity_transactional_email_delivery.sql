-- Blipmood official identity events: private, bounded transactional Brevo outbox.
-- Held until the deployed email-worker supports identity_update (no premature send).
alter table public.email_notification_preferences
 add column if not exists identity_updates boolean not null default true;

alter table private.email_jobs drop constraint if exists email_jobs_template_check;
alter table private.email_jobs add constraint email_jobs_template_check check (template in (
 'contact_received','support_received','advertising_received','message_digest',
 'mention_digest','marketplace_alerts','community_digest',
 'support_status','advertising_status','verification_status','report_status',
 'inactivity_reminder','identity_update'
));

create table if not exists private.identity_email_delivery_controls(
 singleton boolean primary key default true check(singleton),
 delivery_ready boolean not null default false,
 updated_at timestamptz not null default now()
);
alter table private.identity_email_delivery_controls enable row level security;
revoke all on private.identity_email_delivery_controls from public,anon,authenticated;
insert into private.identity_email_delivery_controls(singleton,delivery_ready)
values(true,false) on conflict(singleton) do nothing;

create or replace function private.enqueue_identity_update_email()
returns trigger language plpgsql security definer set search_path='pg_catalog' as $body$
declare
 event_kind text;
 role_code text;
 event_status text;
 address text;
 dispatch_ready boolean;
begin
 if tg_table_name='identity_affiliations' then
   if (tg_op='INSERT' and new.status='pending') or
      (tg_op='UPDATE' and old.status is distinct from new.status) then
     event_kind:=case new.status when 'pending' then 'affiliation_invite'
       when 'active' then 'affiliation_confirmed' when 'revoked' then 'affiliation_revoked' end;
   end if;
 elsif tg_table_name='identity_appointments' then
   if tg_op='INSERT' or (tg_op='UPDATE' and old.status is distinct from new.status) then
     event_kind:=case new.status when 'active' then 'advisor_appointment'
       when 'revoked' then 'appointment_revoked' end;
     role_code:=new.role_code;
   end if;
 elsif tg_table_name='identity_awards' then
   if tg_op='INSERT' and new.is_active then event_kind:='recognition_awarded';
   elsif tg_op='UPDATE' and old.is_active and not new.is_active then event_kind:='recognition_revoked';
   end if;
 elsif tg_table_name='identity_advisor_applications' then
   -- Approval creates an appointment and gets its own email. Avoid duplicate mails.
   if tg_op='UPDATE' and old.status='pending' and new.status='rejected' then
     event_kind:='advisor_decision';
   end if;
 end if;
 if event_kind is null then return new; end if;
 select lower(btrim(u.email)) into address
 from auth.users u join public.profiles p on p.id=u.id
 where u.id=new.user_id and u.email_confirmed_at is not null
   and u.deleted_at is null and coalesce(p.account_status,'active')='active'
 limit 1;
 if address is null or length(address)>320
    or address !~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$'
 then return new; end if;
 if exists(select 1 from private.email_suppressions s where s.email=address) then return new; end if;
 if exists(select 1 from public.email_notification_preferences p
    where p.user_id=new.user_id and p.identity_updates=false) then return new; end if;
 perform pg_advisory_xact_lock(77091422);
 if (select count(*) from private.email_jobs where created_at>now()-interval '24 hours')>=180
 then return new; end if;
 select delivery_ready into dispatch_ready from private.identity_email_delivery_controls where singleton;
 insert into private.email_jobs(event_key,template,recipient_email,payload,next_attempt_at)
 values(
   'identity:'||event_kind||':'||new.id::text||':'||txid_current()::text,
   'identity_update',address,
   jsonb_build_object('user_id',new.user_id,'record_id',new.id,
     'identity_action',event_kind,'role',coalesce(role_code,'')),
   case when coalesce(dispatch_ready,false) then now() else 'infinity'::timestamptz end
 ) on conflict(event_key) do nothing;
 return new;
exception when others then
 -- Email transport/queue must never undo a reviewed appointment or award.
 raise warning 'Identity email enqueue failed safely (SQLSTATE %)',SQLSTATE;
 return new;
end $body$;
revoke all on function private.enqueue_identity_update_email() from public,anon,authenticated;
drop trigger if exists identity_affiliation_email on public.identity_affiliations;
create trigger identity_affiliation_email after insert or update of status on public.identity_affiliations
for each row execute function private.enqueue_identity_update_email();
drop trigger if exists identity_appointment_email on public.identity_appointments;
create trigger identity_appointment_email after insert or update of status on public.identity_appointments
for each row execute function private.enqueue_identity_update_email();
drop trigger if exists identity_award_email on public.identity_awards;
create trigger identity_award_email after insert or update of is_active on public.identity_awards
for each row execute function private.enqueue_identity_update_email();
drop trigger if exists identity_advisor_decision_email on public.identity_advisor_applications;
create trigger identity_advisor_decision_email after update of status on public.identity_advisor_applications
for each row execute function private.enqueue_identity_update_email();

create or replace function public.can_send_identity_update(
 p_email text,p_user_id uuid,p_record_id uuid,p_action text
) returns boolean language plpgsql stable security definer set search_path='pg_catalog' as $body$
declare address text:=lower(btrim(coalesce(p_email,'')));
begin
 if current_setting('role',true) is distinct from 'service_role' then raise exception 'forbidden'; end if;
 if p_user_id is null or p_record_id is null or p_action is null then return false; end if;
 if not exists(select 1 from auth.users u
   join public.profiles pr on pr.id=u.id
   where u.id=p_user_id and u.deleted_at is null and u.email_confirmed_at is not null
     and lower(btrim(u.email))=address and coalesce(pr.account_status,'active')='active')
 then return false; end if;
 if exists(select 1 from private.email_suppressions s where s.email=address) then return false; end if;
 if exists(select 1 from public.email_notification_preferences p
    where p.user_id=p_user_id and p.identity_updates=false) then return false; end if;
 if p_action in ('advisor_appointment','appointment_revoked') then
   return exists(select 1 from public.identity_appointments a where a.id=p_record_id and a.user_id=p_user_id
     and a.status=case when p_action='advisor_appointment' then 'active' else 'revoked' end
     and (p_action='appointment_revoked' or a.expires_at is null or a.expires_at>now()));
 elsif p_action in ('affiliation_invite','affiliation_confirmed','affiliation_revoked') then
   return exists(select 1 from public.identity_affiliations a
     left join public.identity_organizations o on o.id=a.organization_id
     where a.id=p_record_id and a.user_id=p_user_id
       and a.status=case p_action when 'affiliation_invite' then 'pending'
         when 'affiliation_confirmed' then 'active' else 'revoked' end
       and (p_action='affiliation_revoked' or o.status='verified'));
 elsif p_action in ('recognition_awarded','recognition_revoked') then
   return exists(select 1 from public.identity_awards a where a.id=p_record_id and a.user_id=p_user_id
      and a.is_active=(p_action='recognition_awarded')
      and (p_action='recognition_revoked' or a.expires_at is null or a.expires_at>now()));
 elsif p_action='advisor_decision' then
   return exists(select 1 from public.identity_advisor_applications a
     where a.id=p_record_id and a.user_id=p_user_id and a.status='rejected');
 end if;
 return false;
end $body$;
revoke all on function public.can_send_identity_update(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.can_send_identity_update(text,uuid,uuid,text) to service_role;
notify pgrst,'reload schema';
