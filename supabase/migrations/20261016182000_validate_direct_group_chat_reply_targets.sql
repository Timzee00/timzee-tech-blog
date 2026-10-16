-- Only permit a reply to a message in the same conversation.
create or replace function public.validate_chat_reply_target()
returns trigger language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
 if new.reply_to is not null and not exists (
   select 1 from public.direct_messages prior
   where prior.id=new.reply_to
     and prior.thread_id=new.thread_id
     and prior.deleted_at is null
     and prior.created_at<=new.created_at
 ) then
   raise exception 'The replied-to message must belong to this conversation and still be available' using errcode='23514';
 end if;
 return new;
end;
$$;
drop trigger if exists direct_messages_validate_reply on public.direct_messages;
create trigger direct_messages_validate_reply before insert or update of reply_to on public.direct_messages
 for each row execute function public.validate_chat_reply_target();