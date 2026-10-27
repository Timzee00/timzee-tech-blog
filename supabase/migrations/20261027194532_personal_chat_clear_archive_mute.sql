-- Blipmood: per-account chat clearing, archiving and muting.
-- CLEAR is a visibility cutoff, never a physical deletion of messages.
-- Existing message visibility and group suspension policies remain enforced.
create table if not exists public.chat_personal_views (
  user_id uuid not null references auth.users(id) on delete cascade,
  thread_id text not null check (char_length(thread_id) between 36 and 73),
  archived boolean not null default false,
  muted boolean not null default false,
  cleared_before timestamp without time zone,
  updated_at timestamptz not null default now(),
  primary key(user_id,thread_id)
);
create index if not exists chat_personal_views_user_archive_idx
  on public.chat_personal_views(user_id,archived,updated_at desc);
alter table public.chat_personal_views enable row level security;
revoke all on public.chat_personal_views from PUBLIC,anon,authenticated;
grant select on public.chat_personal_views to authenticated;
drop policy if exists chat_personal_views_self_read on public.chat_personal_views;
create policy chat_personal_views_self_read on public.chat_personal_views
  for select to authenticated using (user_id = (select auth.uid()));

-- Only signed-in participants may update their own preferences. Group
-- membership is verified on the server; DM IDs must be their canonical
-- sorted-UUID pair containing the caller.
create or replace function public.set_chat_personal_view(
  p_thread_id text,
  p_archived boolean default null,
  p_muted boolean default null,
  p_clear boolean default false
) returns jsonb
language plpgsql security definer set search_path to ''
as $function$
declare
  v_actor uuid := (select auth.uid());
  v_parts text[];
  v_peer text;
  v_valid boolean := false;
  v_row public.chat_personal_views%rowtype;
begin
  if v_actor is null or p_thread_id is null then
    raise exception 'Sign in to manage your conversation' using errcode='42501';
  end if;
  if p_thread_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
    select exists (
      select 1 from public.chat_threads t join public.chat_members m
        on m.thread_id=t.id and m.user_id=v_actor
      where t.id::text=p_thread_id and t.is_group
    ) into v_valid;
  elsif p_thread_id ~* '^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}_[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$' then
    v_parts:=string_to_array(p_thread_id,'_');
    v_valid:=v_parts[1]<v_parts[2] and v_actor::text=any(v_parts);
  end if;
  if not v_valid then
    raise exception 'You cannot change another conversation' using errcode='42501';
  end if;
  insert into public.chat_personal_views as prefs
    (user_id,thread_id,archived,muted,cleared_before)
  values (
    v_actor,p_thread_id,
    coalesce(p_archived,false),
    coalesce(p_muted,coalesce(p_archived,false)),
    case when p_clear then timezone('utc',now()) else null end
  )
  on conflict(user_id,thread_id) do update set
    archived=coalesce(p_archived,prefs.archived),
    muted=coalesce(p_muted,case when p_archived is true then true else prefs.muted end),
    cleared_before=case when p_clear then timezone('utc',now())
                        else prefs.cleared_before end,
    updated_at=now()
  returning * into v_row;
  return jsonb_build_object(
    'thread_id',v_row.thread_id,'archived',v_row.archived,
    'muted',v_row.muted,'cleared_before',v_row.cleared_before,
    'updated_at',v_row.updated_at);
end
$function$;
revoke all on function public.set_chat_personal_view(text,boolean,boolean,boolean) from PUBLIC,anon;
grant execute on function public.set_chat_personal_view(text,boolean,boolean,boolean) to authenticated;

-- An authenticated reader can no longer fetch messages that they personally
-- cleared, including by using a direct REST query or older-messages pagination.
-- This restrictive rule is AND-ed with every pre-existing per-user/group SELECT
-- policy. It never removes another member's messages.
drop policy if exists chat_personal_clear_visibility on public.direct_messages;
create policy chat_personal_clear_visibility on public.direct_messages
  as restrictive for select to authenticated
  using (
    created_at is null or not exists (
      select 1 from public.chat_personal_views p
      where p.user_id=(select auth.uid())
        and p.thread_id=direct_messages.thread_id
        and p.cleared_before is not null
        and direct_messages.created_at <= p.cleared_before
    )
  );

-- Archive and mute suppress new direct-chat notifications for the recipient,
-- including downstream push dispatch: the partner's notifications remain intact.
CREATE OR REPLACE FUNCTION public.notify_direct_message_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
  -- Each recipient can silence only their own conversation; other members
  -- and the sender continue to receive their notifications normally.
  if exists(select 1 from public.chat_personal_views prefs
    where prefs.user_id=new.recipient_id and prefs.thread_id=new.thread_id
      and (prefs.muted or prefs.archived))
  then return new; end if;
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
$function$
;
