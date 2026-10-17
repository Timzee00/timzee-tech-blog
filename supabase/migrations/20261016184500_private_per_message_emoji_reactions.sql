-- Efficient private reactions, one reaction per person per message.
create table if not exists public.chat_message_reactions(
 message_id uuid not null references public.direct_messages(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 thread_id text not null,
 emoji text not null check (emoji in ('👍','❤️','😂','😮','😢','🔥')),
 updated_at timestamptz not null default now(),
 primary key(message_id,user_id)
);
create index if not exists chat_reactions_thread_idx on public.chat_message_reactions(thread_id,message_id);
alter table public.chat_message_reactions enable row level security;
revoke all on public.chat_message_reactions from anon,authenticated;
grant select on public.chat_message_reactions to authenticated;
drop policy if exists "Participants view chat reactions" on public.chat_message_reactions;
create policy "Participants view chat reactions" on public.chat_message_reactions
 for select to authenticated using(
  exists(select 1 from public.direct_messages dm where dm.id=message_id
   and (dm.sender_id=(select auth.uid()) or dm.recipient_id=(select auth.uid())
    or public.is_chat_member(dm.thread_id,(select auth.uid()))))
 );

create or replace function public.react_to_chat_message(p_message_id uuid,p_emoji text)
returns text language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 v_actor uuid:=auth.uid();
 v_msg public.direct_messages%rowtype;
 v_old text;
begin
 if v_actor is null then raise exception 'Sign in to react' using errcode='42501'; end if;
 if p_emoji not in ('👍','❤️','😂','😮','😢','🔥') then
  raise exception 'Unsupported reaction' using errcode='22023';
 end if;
 select * into v_msg from public.direct_messages dm where dm.id=p_message_id;
 if not found or v_msg.deleted_at is not null then
  raise exception 'Message unavailable' using errcode='22023';
 end if;
 if not (v_actor=v_msg.sender_id or v_actor=v_msg.recipient_id
   or public.is_chat_member(v_msg.thread_id,v_actor)) then
  raise exception 'Not a participant' using errcode='42501';
 end if;
 select r.emoji into v_old from public.chat_message_reactions r
 where r.message_id=p_message_id and r.user_id=v_actor for update;
 if found and v_old=p_emoji then
  delete from public.chat_message_reactions r where r.message_id=p_message_id and r.user_id=v_actor;
  return null;
 end if;
 insert into public.chat_message_reactions(message_id,user_id,thread_id,emoji)
 values(p_message_id,v_actor,v_msg.thread_id,p_emoji)
 on conflict(message_id,user_id) do update set emoji=excluded.emoji,updated_at=now();
 return p_emoji;
end;
$$;
revoke all on function public.react_to_chat_message(uuid,text) from public,anon;
grant execute on function public.react_to_chat_message(uuid,text) to authenticated;

create or replace function public.chat_reaction_counts(p_message_ids uuid[])
returns table(message_id uuid,emoji text,reaction_count integer,mine boolean)
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_actor uuid:=auth.uid();
begin
 if v_actor is null then raise exception 'Sign in to view reactions' using errcode='42501'; end if;
 if p_message_ids is null or coalesce(array_length(p_message_ids,1),0)>80 then
  raise exception 'Pass at most 80 message IDs' using errcode='22023';
 end if;
 return query
 select r.message_id,r.emoji,count(*)::integer,bool_or(r.user_id=v_actor)
 from public.chat_message_reactions r
 join public.direct_messages dm on dm.id=r.message_id
 where r.message_id=any(p_message_ids) and dm.deleted_at is null
 and (dm.sender_id=v_actor or dm.recipient_id=v_actor or public.is_chat_member(dm.thread_id,v_actor))
 group by r.message_id,r.emoji;
end;
$$;
revoke all on function public.chat_reaction_counts(uuid[]) from public,anon;
grant execute on function public.chat_reaction_counts(uuid[]) to authenticated;

do $$
begin
 if not exists(select 1 from pg_publication_tables
  where pubname='supabase_realtime' and schemaname='public' and tablename='chat_message_reactions') then
  alter publication supabase_realtime add table public.chat_message_reactions;
 end if;
end $$;
