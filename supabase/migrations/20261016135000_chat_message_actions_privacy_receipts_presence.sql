-- Authenticated message actions, receipt privacy, and approximate chat activity.
alter table public.direct_messages
 add column if not exists deleted_at timestamptz,
 add column if not exists pinned_at timestamptz,
 add column if not exists pinned_by uuid references auth.users(id) on delete set null;
create index if not exists direct_messages_pins_idx on public.direct_messages(thread_id,pinned_at desc) where pinned_at is not null;
create table if not exists public.chat_privacy (
 user_id uuid primary key references auth.users(id) on delete cascade,
 read_receipts boolean not null default true,
 show_online boolean not null default true,
 updated_at timestamptz not null default now());
alter table public.chat_privacy enable row level security;
revoke all on public.chat_privacy from anon;
grant select,insert,update on public.chat_privacy to authenticated;
drop policy if exists "Own chat privacy" on public.chat_privacy;
create policy "Own chat privacy" on public.chat_privacy for all to authenticated
 using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
create table if not exists public.chat_thread_reads (
 thread_id text not null,
 user_id uuid not null references auth.users(id) on delete cascade,
 read_at timestamptz not null default now(),
 primary key(thread_id,user_id));
alter table public.chat_thread_reads enable row level security;
revoke all on public.chat_thread_reads from anon,authenticated;
grant select,insert,update on public.chat_thread_reads to service_role;
create index if not exists chat_thread_reads_user_idx on public.chat_thread_reads(user_id);
create table if not exists public.chat_activity (
 user_id uuid primary key references auth.users(id) on delete cascade,
 seen_at timestamptz not null default now());
alter table public.chat_activity enable row level security;
revoke all on public.chat_activity from anon,authenticated;
grant select,insert,update on public.chat_activity to service_role;

CREATE OR REPLACE FUNCTION public.chat_contact_activity(p_other uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 v_uid uuid:=auth.uid();
 v_seen timestamptz;
 v_show boolean;
 v_blocked boolean;
 v_contact boolean;
begin
 if v_uid is null or p_other is null or p_other=v_uid then
   return jsonb_build_object('visible',false);
 end if;
 select exists(select 1 from public.friendships f where f.status='blocked'
    and ((f.requester_id=v_uid and f.addressee_id=p_other)
      or (f.requester_id=p_other and f.addressee_id=v_uid))) into v_blocked;
 if v_blocked then return jsonb_build_object('visible',false); end if;
 select exists(select 1 from public.friendships f where f.status='accepted'
    and ((f.requester_id=v_uid and f.addressee_id=p_other)
      or (f.requester_id=p_other and f.addressee_id=v_uid)))
 or exists(select 1 from public.direct_messages dm where
   (dm.sender_id=v_uid and dm.recipient_id=p_other)
   or (dm.sender_id=p_other and dm.recipient_id=v_uid))
 into v_contact;
 if not v_contact then return jsonb_build_object('visible',false); end if;
 select coalesce(cp.show_online,true) into v_show from public.chat_privacy cp where cp.user_id=p_other;
 if coalesce(v_show,true) is false then return jsonb_build_object('visible',false); end if;
 select ca.seen_at into v_seen from public.chat_activity ca where ca.user_id=p_other;
 return jsonb_build_object('visible',true,'active_in_chat',
   coalesce(v_seen>now()-interval '95 seconds',false),
   'last_active_at',v_seen);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.chat_message_info(p_message_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 v_uid uuid:=auth.uid();
 v_msg public.direct_messages%rowtype;
 v_readers jsonb:='[]'::jsonb;
 v_recipient_privacy boolean:=true;
begin
 if v_uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select dm.* into v_msg from public.direct_messages dm where dm.id=p_message_id;
 if not found then raise exception 'Message not found' using errcode='22023'; end if;
 if v_msg.recipient_id is null then
   if not public.is_chat_member(v_msg.thread_id,v_uid) then
     raise exception 'Not a member of this conversation' using errcode='42501'; end if;
 else
   if v_uid not in (v_msg.sender_id,v_msg.recipient_id) then
     raise exception 'Not a participant' using errcode='42501'; end if;
 end if;
 if v_msg.sender_id<>v_uid then
   return jsonb_build_object('sent_at',v_msg.created_at,'own_message',false);
 end if;
 if v_msg.recipient_id is not null then
   select coalesce(cp.read_receipts,true) into v_recipient_privacy
     from public.chat_privacy cp where cp.user_id=v_msg.recipient_id;
   if coalesce(v_recipient_privacy,true) then
     select coalesce(jsonb_agg(jsonb_build_object(
       'name',coalesce(p.display_name,p.username,'Member'),
       'read_at',r.read_at
     )), '[]'::jsonb) into v_readers
     from public.chat_thread_reads r
     join public.profiles p on p.id=r.user_id
     where r.thread_id=v_msg.thread_id
       and r.user_id=v_msg.recipient_id
       and r.read_at>=v_msg.created_at at time zone 'UTC';
   end if;
 else
   select coalesce(jsonb_agg(jsonb_build_object('name',q.display_name,'read_at',q.read_at)
      order by q.read_at desc),'[]'::jsonb) into v_readers
   from (
     select coalesce(p.display_name,p.username,'Member') as display_name,r.read_at
     from public.chat_thread_reads r
     join public.chat_members cm on cm.thread_id=v_msg.thread_id::uuid and cm.user_id=r.user_id
     join public.profiles p on p.id=r.user_id
     left join public.chat_privacy cp on cp.user_id=r.user_id
     where r.thread_id=v_msg.thread_id
       and r.user_id<>v_uid
       and coalesce(cp.read_receipts,true)
       and r.read_at>=v_msg.created_at at time zone 'UTC'
     limit 200
   ) q;
 end if;
 return jsonb_build_object('sent_at',v_msg.created_at,'own_message',true,
   'readers',v_readers,'recipient_receipts_enabled',coalesce(v_recipient_privacy,true),
   'pinned',v_msg.pinned_at is not null,'deleted',v_msg.deleted_at is not null);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.chat_touch_activity()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_uid uuid:=auth.uid();
begin
 if v_uid is null then return; end if;
 insert into public.chat_activity(user_id,seen_at) values(v_uid,now())
 on conflict(user_id) do update set seen_at=excluded.seen_at;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.mark_chat_thread_read(p_message_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_uid uuid:=auth.uid(); v_msg public.direct_messages%rowtype; v_optout boolean;
begin
 if v_uid is null then return false; end if;
 select dm.* into v_msg from public.direct_messages dm where dm.id=p_message_id;
 if not found then return false; end if;
 if v_msg.recipient_id is null then
   if not public.is_chat_member(v_msg.thread_id,v_uid) then return false; end if;
 else
   if v_uid not in (v_msg.sender_id,v_msg.recipient_id) then return false; end if;
 end if;
 select not cp.read_receipts into v_optout from public.chat_privacy cp where cp.user_id=v_uid;
 if coalesce(v_optout,false) then return false; end if;
 insert into public.chat_thread_reads(thread_id,user_id,read_at)
 values(v_msg.thread_id,v_uid, v_msg.created_at at time zone 'UTC')
 on conflict(thread_id,user_id) do update
 set read_at=greatest(public.chat_thread_reads.read_at,excluded.read_at);
 return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.toggle_chat_message_pin(p_message_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
 v_uid uuid:=auth.uid();
 v_row public.direct_messages%rowtype;
 v_group uuid;
 v_authorized boolean:=false;
 v_pin_count integer;
begin
 if v_uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
 select * into v_row from public.direct_messages dm where dm.id=p_message_id for update;
 if not found or v_row.deleted_at is not null then raise exception 'Message unavailable' using errcode='22023'; end if;
 if v_row.recipient_id is not null then
   v_authorized:=v_uid in (v_row.sender_id,v_row.recipient_id);
 else
   begin v_group:=v_row.thread_id::uuid;
   exception when invalid_text_representation then v_group:=null; end;
   select exists (
     select 1 from public.chat_threads ct where ct.id=v_group and ct.created_by=v_uid
   ) or exists (
     select 1 from public.chat_members cm where cm.thread_id=v_group
       and cm.user_id=v_uid and cm.role in ('owner','admin')
   ) into v_authorized;
 end if;
 if not v_authorized then raise exception 'You cannot manage pins in this conversation' using errcode='42501'; end if;
 if v_row.pinned_at is not null then
   update public.direct_messages dm set pinned_at=null,pinned_by=null where dm.id=p_message_id;
   return false;
 end if;
 select count(*) into v_pin_count from public.direct_messages dm
   where dm.thread_id=v_row.thread_id and dm.pinned_at is not null;
 if v_pin_count>=3 then raise exception 'Unpin a message first (maximum three)' using errcode='22023'; end if;
 update public.direct_messages dm set pinned_at=now(),pinned_by=v_uid where dm.id=p_message_id;
 return true;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.unsend_chat_message(p_message_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_row public.direct_messages%rowtype;
begin
  if v_uid is null then raise exception 'Authentication required' using errcode='42501'; end if;
  select * into v_row from public.direct_messages dm where dm.id=p_message_id for update;
  if not found or v_row.sender_id is distinct from v_uid then
    raise exception 'Only the sender can unsend this message' using errcode='42501';
  end if;
  if v_row.deleted_at is not null then return true; end if;
  if v_row.created_at < (now() at time zone 'UTC') - interval '48 hours' then
    raise exception 'Unsend is available within 48 hours of sending' using errcode='22023';
  end if;
  update public.direct_messages dm
     set body=null,media_url=null,media_path=null,media_type=null,
         deleted_at=now(),pinned_at=null,pinned_by=null
   where dm.id=p_message_id and dm.sender_id=v_uid;
  return true;
end;
$function$
;
revoke all on function public.chat_contact_activity(uuid) from public,anon;
grant execute on function public.chat_contact_activity(uuid) to authenticated;
revoke all on function public.chat_message_info(uuid) from public,anon;
grant execute on function public.chat_message_info(uuid) to authenticated;
revoke all on function public.chat_touch_activity() from public,anon;
grant execute on function public.chat_touch_activity() to authenticated;
revoke all on function public.mark_chat_thread_read(uuid) from public,anon;
grant execute on function public.mark_chat_thread_read(uuid) to authenticated;
revoke all on function public.toggle_chat_message_pin(uuid) from public,anon;
grant execute on function public.toggle_chat_message_pin(uuid) to authenticated;
revoke all on function public.unsend_chat_message(uuid) from public,anon;
grant execute on function public.unsend_chat_message(uuid) to authenticated;
