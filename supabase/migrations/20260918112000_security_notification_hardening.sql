-- Security and notification hardening applied to production.
-- Source of truth for the public profile projection, private profile access,
-- recipient-safe notification writes, and discussion notification triggers.

begin;

create table if not exists public.public_profiles (
  id uuid primary key references public.profiles(id) on delete cascade,
  display_name text,
  bio text,
  avatar_url text,
  role text,
  created_at timestamp without time zone,
  updated_at timestamptz,
  is_verified boolean,
  verification_tier text,
  verified_at timestamp without time zone,
  username text,
  email text,
  cover_url text,
  headline text,
  location text,
  website text,
  allow_messages boolean,
  allow_requests boolean,
  show_email boolean,
  points integer,
  level text,
  is_featured boolean,
  is_staff_pick boolean,
  marketplace_whatsapp text
);

alter table public.public_profiles enable row level security;
revoke all on table public.public_profiles from public, anon, authenticated;
grant select on table public.public_profiles to anon, authenticated, service_role;

drop policy if exists "Public profile directory read" on public.public_profiles;
create policy "Public profile directory read"
on public.public_profiles
for select
to anon, authenticated
using (true);

create index if not exists public_profiles_username_idx
  on public.public_profiles (lower(username))
  where username is not null;

create or replace function private.sync_public_profile()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
begin
  if tg_op = 'DELETE' then
    delete from public.public_profiles where id = old.id;
    return old;
  end if;

  insert into public.public_profiles (
    id, display_name, bio, avatar_url, role, created_at, updated_at,
    is_verified, verification_tier, verified_at, username, email,
    cover_url, headline, location, website, allow_messages,
    allow_requests, show_email, points, level, is_featured,
    is_staff_pick, marketplace_whatsapp
  )
  values (
    new.id, new.display_name, new.bio, new.avatar_url, new.role,
    new.created_at, new.updated_at, new.is_verified, new.verification_tier,
    new.verified_at, new.username,
    case when coalesce(new.show_email, false) then new.email else null end,
    new.cover_url, new.headline, new.location, new.website,
    new.allow_messages, new.allow_requests, new.show_email, new.points,
    new.level, new.is_featured, new.is_staff_pick, new.marketplace_whatsapp
  )
  on conflict (id) do update set
    display_name=excluded.display_name,
    bio=excluded.bio,
    avatar_url=excluded.avatar_url,
    role=excluded.role,
    created_at=excluded.created_at,
    updated_at=excluded.updated_at,
    is_verified=excluded.is_verified,
    verification_tier=excluded.verification_tier,
    verified_at=excluded.verified_at,
    username=excluded.username,
    email=excluded.email,
    cover_url=excluded.cover_url,
    headline=excluded.headline,
    location=excluded.location,
    website=excluded.website,
    allow_messages=excluded.allow_messages,
    allow_requests=excluded.allow_requests,
    show_email=excluded.show_email,
    points=excluded.points,
    level=excluded.level,
    is_featured=excluded.is_featured,
    is_staff_pick=excluded.is_staff_pick,
    marketplace_whatsapp=excluded.marketplace_whatsapp;

  return new;
end;
$$;

revoke all on function private.sync_public_profile() from public, anon, authenticated;

drop trigger if exists trg_sync_public_profile on public.profiles;
create trigger trg_sync_public_profile
after insert or update or delete on public.profiles
for each row execute function private.sync_public_profile();

insert into public.public_profiles (
  id, display_name, bio, avatar_url, role, created_at, updated_at,
  is_verified, verification_tier, verified_at, username, email,
  cover_url, headline, location, website, allow_messages,
  allow_requests, show_email, points, level, is_featured,
  is_staff_pick, marketplace_whatsapp
)
select
  p.id, p.display_name, p.bio, p.avatar_url, p.role, p.created_at, p.updated_at,
  p.is_verified, p.verification_tier, p.verified_at, p.username,
  case when coalesce(p.show_email, false) then p.email else null end,
  p.cover_url, p.headline, p.location, p.website, p.allow_messages,
  p.allow_requests, p.show_email, p.points, p.level, p.is_featured,
  p.is_staff_pick, p.marketplace_whatsapp
from public.profiles p
on conflict (id) do update set
  display_name=excluded.display_name,
  bio=excluded.bio,
  avatar_url=excluded.avatar_url,
  role=excluded.role,
  created_at=excluded.created_at,
  updated_at=excluded.updated_at,
  is_verified=excluded.is_verified,
  verification_tier=excluded.verification_tier,
  verified_at=excluded.verified_at,
  username=excluded.username,
  email=excluded.email,
  cover_url=excluded.cover_url,
  headline=excluded.headline,
  location=excluded.location,
  website=excluded.website,
  allow_messages=excluded.allow_messages,
  allow_requests=excluded.allow_requests,
  show_email=excluded.show_email,
  points=excluded.points,
  level=excluded.level,
  is_featured=excluded.is_featured,
  is_staff_pick=excluded.is_staff_pick,
  marketplace_whatsapp=excluded.marketplace_whatsapp;

create or replace function public.protect_profile_privileged_fields()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $
begin
  if (select auth.uid()) is not null then
    if tg_op = 'INSERT' then
      if new.id is distinct from (select auth.uid()) then
        raise exception 'Profile identity cannot be changed';
      end if;
      if lower(coalesce(new.role, 'user')) <> 'user'
         or coalesce(new.is_verified, false)
         or lower(coalesce(new.verification_tier, 'standard')) <> 'standard'
         or lower(coalesce(new.account_status, 'active')) <> 'active'
         or coalesce(new.verified_at, null) is not null
         or coalesce(new.points, 0) <> 0
         or coalesce(new.is_featured, false)
         or coalesce(new.is_staff_pick, false) then
        raise exception 'Protected profile fields can only be initialized by the server';
      end if;
    else
      if new.id is distinct from old.id then
        raise exception 'Profile identity cannot be changed';
      end if;
      if new.role is distinct from old.role
         or new.is_verified is distinct from old.is_verified
         or new.verification_tier is distinct from old.verification_tier
         or new.account_status is distinct from old.account_status
         or new.verified_at is distinct from old.verified_at
         or new.points is distinct from old.points
         or new.level is distinct from old.level
         or new.is_featured is distinct from old.is_featured
         or new.is_staff_pick is distinct from old.is_staff_pick
         or new.created_at is distinct from old.created_at then
        raise exception 'Protected profile fields can only be changed by the server';
      end if;
    end if;
  end if;
  return new;
end;
$;

drop policy if exists "Profiles are public" on public.profiles;
drop policy if exists "Profile owners and staff read full profiles" on public.profiles;
create policy "Profile owners and staff read full profiles"
on public.profiles
for select
to authenticated
using (
  (select auth.uid()) = id
  or (select public.has_role_secure('moderator'))
  or (select public.has_role_secure('admin'))
  or (select public.has_role_secure('super'))
);

drop policy if exists "Authenticated create notifications" on public.notifications;
drop policy if exists "Users can insert their own notifications" on public.notifications;
create policy "Users can insert their own notifications"
on public.notifications
for insert
to authenticated
with check ((select auth.uid()) = user_id);

create or replace function public.notify_discussion_message_event()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $$
declare
  recipient uuid;
  recipient_pref boolean;
  target_username text;
  target_user uuid;
  display_author text := coalesce(new.author_name, 'Someone');
begin
  if new.author_id is null then return new; end if;

  if new.reply_to is not null then
    select dm.author_id into recipient
    from public.discussion_messages dm
    where dm.id = new.reply_to and dm.author_id is not null;

    if recipient is not null and recipient <> new.author_id then
      select coalesce(p.notify_replies, true) into recipient_pref
      from public.profiles p where p.id = recipient;

      if coalesce(recipient_pref, true) then
        perform public.emit_user_notification(
          recipient,
          'reply',
          'New discussion reply',
          display_author || ' replied to your discussion message.',
          '/discussion.html?topic=' || coalesce(new.topic_id::text, ''),
          jsonb_build_object(
            'message_id', new.id,
            'reply_to', new.reply_to,
            'topic_id', new.topic_id,
            'actor_id', new.author_id
          )
        );
      end if;
    end if;
  end if;

  if new.body is not null then
    for target_username in
      select distinct lower(m[1])
      from regexp_matches(new.body, '@([a-zA-Z0-9_]+)', 'g') as m
    loop
      select p.id into target_user
      from public.profiles p
      where lower(p.username) = target_username
      limit 1;

      if target_user is null or target_user = new.author_id then continue; end if;

      select coalesce(p.notify_mentions, true) into recipient_pref
      from public.profiles p where p.id = target_user;

      if coalesce(recipient_pref, true) then
        perform public.emit_user_notification(
          target_user,
          'mention',
          'You were mentioned',
          display_author || ' mentioned you in a discussion.',
          '/discussion.html?topic=' || coalesce(new.topic_id::text, ''),
          jsonb_build_object(
            'message_id', new.id,
            'topic_id', new.topic_id,
            'actor_id', new.author_id
          )
        );
      end if;
    end loop;
  end if;

  return new;
end;
$$;

revoke all on function public.notify_discussion_message_event() from public, anon, authenticated;

drop trigger if exists discussion_messages_notification_after_insert on public.discussion_messages;
create trigger discussion_messages_notification_after_insert
after insert on public.discussion_messages
for each row execute function public.notify_discussion_message_event();

commit;
