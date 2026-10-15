-- Secure direct messages: trusted staff can initiate without a friendship.
-- Blocks, recipient message preferences, and mutual relationships are preserved.
-- Sender can never use a role claim from their own editable user_metadata.
-- This migration doesn't send, modify, or remove any existing message.
create index if not exists direct_messages_pair_sender_lookup
 on public.direct_messages(sender_id,recipient_id,created_at desc)
 where recipient_id is not null;
create index if not exists direct_messages_pair_recipient_lookup
 on public.direct_messages(recipient_id,sender_id,created_at desc)
 where recipient_id is not null;

create table if not exists private.staff_dm_initiations(
 id bigint generated always as identity primary key,
 actor_id uuid not null references auth.users(id) on delete cascade,
 recipient_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 unique(actor_id,recipient_id)
);
create index if not exists staff_dm_initiations_recent_idx
 on private.staff_dm_initiations(actor_id,created_at desc);
alter table private.staff_dm_initiations enable row level security;
revoke all on private.staff_dm_initiations from public,anon,authenticated;
grant select on private.staff_dm_initiations to service_role;

create or replace function public.can_start_staff_dm()
returns boolean language sql stable security definer
set search_path=pg_catalog,public
as $$
 select exists(
  select 1 from public.profiles p
  where p.id=(select auth.uid())
    and p.role in ('moderator','admin','super')
    and p.account_status='active'
 );
$$;
revoke all on function public.can_start_staff_dm() from public,anon;
grant execute on function public.can_start_staff_dm() to authenticated,service_role;

create or replace function public.can_send_direct_message(p_recipient uuid)
returns boolean language plpgsql stable security definer
set search_path=pg_catalog,public
as $$
declare sender uuid:=auth.uid(); role_name text; accepted boolean; previous_staff_message boolean;
begin
 if sender is null or p_recipient is null or sender=p_recipient then return false; end if;
 if not exists(select 1 from public.profiles p where p.id=sender and p.account_status='active') then return false; end if;
 if not exists(select 1 from public.profiles p where p.id=p_recipient
          and p.account_status='active' and p.allow_messages is distinct from false) then return false; end if;
 if exists(select 1 from public.friendships f
           where ((f.requester_id=sender and f.addressee_id=p_recipient)
             or (f.requester_id=p_recipient and f.addressee_id=sender))
             and f.status='blocked') then return false; end if;
 select p.role into role_name from public.profiles p where p.id=sender;
 if role_name in ('super','admin','moderator') then return true;end if;
 if exists(select 1 from public.friendships f
           where ((f.requester_id=sender and f.addressee_id=p_recipient)
             or (f.requester_id=p_recipient and f.addressee_id=sender))
             and f.status='accepted') then return true;end if;
 -- An ordinary member can respond to a staff conversation that staff started.
 if exists(select 1 from public.profiles p where p.id=p_recipient and p.account_status='active'
          and p.role in ('super','admin','moderator'))
   and exists(select 1 from public.direct_messages dm
     where dm.sender_id=p_recipient and dm.recipient_id=sender
       and dm.thread_id=(case when sender::text<p_recipient::text
         then sender::text||'_'||p_recipient::text
         else p_recipient::text||'_'||sender::text end))
 then return true;end if;
 return false;
end
$$;
revoke all on function public.can_send_direct_message(uuid) from public,anon;
grant execute on function public.can_send_direct_message(uuid) to authenticated,service_role;

create or replace function public.enforce_direct_message_permission()
returns trigger language plpgsql security definer
set search_path=pg_catalog,public,private
as $$
declare uid uuid:=auth.uid(); accepted boolean; is_staff boolean; prior_message boolean;
begin
 -- Trusted service calls remain permitted for server-owned workflows.
 if current_setting('request.jwt.claim.role',true)='service_role' then return new; end if;
 if uid is null or new.sender_id is distinct from uid then
    raise exception 'Message sender does not match authenticated account' using errcode='42501';
 end if;
 -- Existing group membership RLS still applies for group conversations.
 if new.recipient_id is null then return new;end if;
 if not public.can_send_direct_message(new.recipient_id) then
   raise exception 'Direct message not permitted: friendship, privacy or block settings' using errcode='42501';
 end if;
 if new.thread_id is distinct from
    (case when uid::text<new.recipient_id::text then uid::text||'_'||new.recipient_id::text
       else new.recipient_id::text||'_'||uid::text end)
 then raise exception 'Invalid direct conversation identifier' using errcode='22023';
 end if;
 select exists(select 1 from public.friendships f where f.status='accepted' and
   ((f.requester_id=uid and f.addressee_id=new.recipient_id) or
    (f.addressee_id=uid and f.requester_id=new.recipient_id))) into accepted;
 select public.can_start_staff_dm() into is_staff;
 -- For unsolicited staff outreach, apply stricter anti-spam and audit.
 if not accepted and is_staff then
    perform pg_advisory_xact_lock(hashtextextended('staff-outreach:'||uid::text,0));
    if (select count(*) from public.direct_messages dm
         where dm.sender_id=uid and dm.recipient_id=new.recipient_id
         and dm.created_at>now()-interval '24 hours')>=100 then
       raise exception 'Staff direct-message recipient limit reached' using errcode='22023';
    end if;
    select exists(select 1 from public.direct_messages dm
      where (dm.sender_id=uid and dm.recipient_id=new.recipient_id)
        or (dm.sender_id=new.recipient_id and dm.recipient_id=uid)) into prior_message;
    if not prior_message then
      if (select count(*) from private.staff_dm_initiations
          where actor_id=uid and created_at>now()-interval '24 hours')>=40 then
        raise exception 'Staff new-conversation daily limit reached' using errcode='22023';
      end if;
      insert into private.staff_dm_initiations(actor_id,recipient_id)
      values(uid,new.recipient_id) on conflict(actor_id,recipient_id) do nothing;
    end if;
 end if;
 return new;
end
$$;
revoke all on function public.enforce_direct_message_permission() from public,anon,authenticated;
drop trigger if exists direct_message_permission_guard on public.direct_messages;
create trigger direct_message_permission_guard
 before insert on public.direct_messages for each row
 execute function public.enforce_direct_message_permission();

-- Add a restrictive RLS backstop: sender and recipient (or group) are verified.
-- The trigger additionally checks friendship, staff role, privacy and blocks.
drop policy if exists direct_message_sender_backstop on public.direct_messages;
create policy direct_message_sender_backstop on public.direct_messages
 as restrictive for insert to authenticated
 with check (
    sender_id=(select auth.uid()) and
    (recipient_id is null or public.can_send_direct_message(recipient_id))
 );
