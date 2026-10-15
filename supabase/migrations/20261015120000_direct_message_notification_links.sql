-- Fix direct-message notifications: chat.html routes direct conversations by
-- ?user=<sender-id>, not ?thread=<pair-id>. Includes staff-initiated messages.
-- Notification recipients can open the conversation without friendship.
create or replace function public.notify_direct_message_event()
returns trigger language plpgsql security definer
set search_path to pg_catalog,public
as $body$
declare
  recipient_pref boolean := true;
  sender_name text;
  sender_role text;
  thread_name text;
  ntype text := 'direct_message';
  ntitle text := 'New message';
  nbody text;
begin
  if new.recipient_id is null or new.sender_id is null
    or new.sender_id=new.recipient_id then return new;end if;
  select coalesce(p.display_name,p.username,'Someone'),p.role
    into sender_name,sender_role from public.profiles p
    where p.id=new.sender_id;
  select ct.name into thread_name from public.chat_threads ct
    where ct.id::text=new.thread_id limit 1;
  select coalesce(p.notify_messages,true) into recipient_pref
    from public.profiles p where p.id=new.recipient_id;
  if not coalesce(recipient_pref,true) then return new;end if;
  if thread_name like 'Marketplace:%' then
    ntype:='marketplace_inquiry'; ntitle:='New marketplace inquiry';
    nbody:='You received a marketplace inquiry.';
  else
    if sender_role in ('moderator','admin','super') then
      ntitle:='New staff message';
    end if;
    nbody:=coalesce(sender_name,'Someone')||' sent you a message.';
  end if;
  perform public.emit_user_notification(
    new.recipient_id,
    ntype,
    ntitle,
    nbody,
    '/chat.html?user='||new.sender_id::text,
    jsonb_build_object('message_id',new.id,'sender_id',new.sender_id,'thread_id',new.thread_id)
  );
  return new;
end
$body$;
