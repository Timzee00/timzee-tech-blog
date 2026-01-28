-- Supabase schema updates for Timzee Tech Hub
-- Run in Supabase SQL editor. Adjust policies as needed for your security model.

-- Themes: allow wallpaper uploads
alter table if exists public.themes
  add column if not exists wallpaper_url text;

-- Discussion topic moderation
alter table if exists public.discussion_topics
  add column if not exists moderation_mode text default 'off';

alter table if exists public.discussion_topics
  add column if not exists banned_words text[] default '{}'::text[];

-- Discussion topic media (optional image/video)
alter table if exists public.discussion_topics
  add column if not exists media_url text;

alter table if exists public.discussion_topics
  add column if not exists media_type text;

-- Discussion messages: replies, media, pinning
alter table if exists public.discussion_messages
  add column if not exists reply_to uuid references public.discussion_messages(id) on delete set null;

alter table if exists public.discussion_messages
  add column if not exists media_url text;

alter table if exists public.discussion_messages
  add column if not exists media_type text;

alter table if exists public.discussion_messages
  add column if not exists pinned boolean default false;

alter table if exists public.discussion_messages
  add column if not exists pinned_at timestamp;

alter table if exists public.discussion_messages
  add column if not exists pinned_by uuid;

-- Discussion bans
create table if not exists public.discussion_bans (
  id uuid primary key,
  topic_id uuid references public.discussion_topics(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  user_name text,
  banned_by uuid,
  reason text,
  created_at timestamp default now()
);

-- Ads (admin-managed)
create table if not exists public.ads (
  id uuid primary key,
  title text,
  body text,
  image_url text,
  link_url text,
  placement text,
  status text,
  starts_at timestamp,
  ends_at timestamp,
  created_by uuid,
  created_at timestamp default now()
);

-- Site settings (single row)
create table if not exists public.site_settings (
  id uuid primary key,
  site_name text,
  tagline text,
  hero_title text,
  hero_intro text,
  rules text,
  theme_accent text,
  comment_moderation boolean default true,
  allow_image_comments boolean default true,
  adsense_enabled boolean default false,
  adsense_publisher_id text,
  adsense_home_top text,
  adsense_home_sidebar text,
  adsense_post_inline text,
  theme_id uuid references public.themes(id) on delete set null,
  created_at timestamp default now(),
  updated_at timestamp
);

alter table if exists public.site_settings
  add column if not exists site_name text,
  add column if not exists tagline text,
  add column if not exists hero_title text,
  add column if not exists hero_intro text,
  add column if not exists rules text,
  add column if not exists theme_accent text,
  add column if not exists comment_moderation boolean default true,
  add column if not exists allow_image_comments boolean default true,
  add column if not exists adsense_enabled boolean default false,
  add column if not exists adsense_publisher_id text,
  add column if not exists adsense_home_top text,
  add column if not exists adsense_home_sidebar text,
  add column if not exists adsense_post_inline text,
  add column if not exists theme_id uuid,
  add column if not exists created_at timestamp default now(),
  add column if not exists updated_at timestamp;

-- Post media gallery (images/videos)
create table if not exists public.post_media (
  id uuid primary key,
  post_id uuid references public.posts(id) on delete cascade,
  url text,
  media_type text,
  sort_order int,
  created_at timestamp default now()
);

-- User profiles
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  username text,
  email text,
  bio text,
  avatar_url text,
  cover_url text,
  headline text,
  location text,
  website text,
  allow_messages boolean default true,
  allow_requests boolean default true,
  show_email boolean default false,
  notify_messages boolean default true,
  notify_replies boolean default true,
  is_verified boolean default false,
  verification_tier text default 'standard',
  account_status text default 'active',
  verified_at timestamp,
  role text,
  created_at timestamp default now(),
  updated_at timestamp
);

alter table if exists public.profiles
  add column if not exists username text,
  add column if not exists email text,
  add column if not exists cover_url text,
  add column if not exists headline text,
  add column if not exists location text,
  add column if not exists website text,
  add column if not exists allow_messages boolean default true,
  add column if not exists allow_requests boolean default true,
  add column if not exists show_email boolean default false,
  add column if not exists notify_messages boolean default true,
  add column if not exists notify_replies boolean default true,
  add column if not exists is_verified boolean default false,
  add column if not exists verification_tier text default 'standard',
  add column if not exists account_status text default 'active',
  add column if not exists verified_at timestamp;

-- Friendships
create table if not exists public.friendships (
  id uuid primary key,
  requester_id uuid references auth.users(id) on delete cascade,
  requester_name text,
  addressee_id uuid references auth.users(id) on delete cascade,
  status text,
  blocked_by uuid,
  blocked_reason text,
  created_at timestamp default now(),
  updated_at timestamp
);

alter table if exists public.friendships
  add column if not exists blocked_by uuid,
  add column if not exists blocked_reason text;

-- Direct messages
create table if not exists public.direct_messages (
  id uuid primary key,
  thread_id text,
  sender_id uuid references auth.users(id) on delete cascade,
  recipient_id uuid references auth.users(id) on delete cascade,
  body text,
  media_url text,
  media_type text,
  created_at timestamp default now()
);

-- Chat threads (group chats)
create table if not exists public.chat_threads (
  id uuid primary key,
  name text,
  is_group boolean default false,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp default now()
);

-- Chat membership
create table if not exists public.chat_members (
  id uuid primary key,
  thread_id uuid references public.chat_threads(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  role text default 'member',
  joined_at timestamp default now()
);

-- Post shares
create table if not exists public.post_shares (
  id uuid primary key,
  post_id uuid references public.posts(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  channel text,
  created_at timestamp default now()
);

-- Contact/Support/Newsletter/Ad Application inboxes
create table if not exists public.contact_requests (
  id uuid primary key,
  name text,
  email text,
  subject text,
  message text,
  created_at timestamp default now(),
  status text default 'open'
);

create table if not exists public.support_requests (
  id uuid primary key,
  name text,
  email text,
  issue text,
  message text,
  created_at timestamp default now(),
  status text default 'open'
);

create table if not exists public.newsletter_signups (
  id uuid primary key,
  name text,
  email text,
  interest text,
  created_at timestamp default now(),
  status text default 'open'
);

create table if not exists public.ad_applications (
  id uuid primary key,
  name text,
  email text,
  company text,
  budget text,
  message text,
  created_at timestamp default now(),
  status text default 'open'
);

alter table if exists public.contact_requests
  add column if not exists status text default 'open';
alter table if exists public.contact_requests
  alter column status set default 'open';

alter table if exists public.support_requests
  add column if not exists status text default 'open';
alter table if exists public.support_requests
  alter column status set default 'open';

alter table if exists public.newsletter_signups
  add column if not exists status text default 'open';

alter table if exists public.ad_applications
  add column if not exists status text default 'open';
alter table if exists public.ad_applications
  alter column status set default 'open';

-- Helpful indexes
create index if not exists discussion_messages_topic_id_idx on public.discussion_messages(topic_id);
create index if not exists discussion_bans_topic_id_idx on public.discussion_bans(topic_id);
create index if not exists direct_messages_thread_id_idx on public.direct_messages(thread_id);
create index if not exists friendships_requester_idx on public.friendships(requester_id);
create index if not exists friendships_addressee_idx on public.friendships(addressee_id);
create index if not exists post_shares_user_id_idx on public.post_shares(user_id);
create index if not exists ads_placement_idx on public.ads(placement);
create index if not exists post_media_post_id_idx on public.post_media(post_id);
drop index if exists profiles_username_idx;
create unique index if not exists profiles_username_unique_idx on public.profiles(lower(username));
create index if not exists profiles_email_idx on public.profiles(email);
create index if not exists chat_members_user_idx on public.chat_members(user_id);
create index if not exists chat_members_thread_idx on public.chat_members(thread_id);

-- RLS policies (review and tighten for production)

-- Discussion topics
alter table public.discussion_topics enable row level security;
drop policy if exists "Discussion topics are public" on public.discussion_topics;
create policy "Discussion topics are public" on public.discussion_topics
  for select using (true);
drop policy if exists "Users create topics" on public.discussion_topics;
create policy "Users create topics" on public.discussion_topics
  for insert with check (auth.uid() = author_id);
drop policy if exists "Topic owners update" on public.discussion_topics;
create policy "Topic owners update" on public.discussion_topics
  for update using (auth.uid() = author_id);
drop policy if exists "Topic owners delete" on public.discussion_topics;
create policy "Topic owners delete" on public.discussion_topics
  for delete using (auth.uid() = author_id);

-- Discussion messages
alter table public.discussion_messages enable row level security;
drop policy if exists "Discussion messages are public" on public.discussion_messages;
create policy "Discussion messages are public" on public.discussion_messages
  for select using (true);

-- Block banned users from posting
create or replace function public.user_not_banned(p_topic uuid, p_user uuid)
returns boolean
language plpgsql
stable
as $$
begin
  if p_topic is null or p_user is null then
    return true;
  end if;
  return not exists (
    select 1
    from public.discussion_bans ban
    where ban.topic_id = p_topic
      and ban.user_id = p_user
  );
end;
$$;

drop policy if exists "Users send messages" on public.discussion_messages;
create policy "Users send messages" on public.discussion_messages
  for insert with check (
    auth.uid() = author_id
    and public.user_not_banned(discussion_messages.topic_id, auth.uid())
  );
drop policy if exists "Topic owners pin messages" on public.discussion_messages;
create policy "Topic owners pin messages" on public.discussion_messages
  for update using (
    exists (
      select 1 from public.discussion_topics t
      where t.id = discussion_messages.topic_id
        and t.author_id = auth.uid()
    )
  );

-- Server-side moderation for discussion messages
create or replace function public.apply_topic_moderation()
returns trigger
language plpgsql
as $$
declare
  topic_mode text;
  banned text[];
  word text;
begin
  select moderation_mode, banned_words into topic_mode, banned
  from public.discussion_topics
  where id = NEW.topic_id;

  if NEW.body is null or NEW.body = '' then
    return NEW;
  end if;

  if banned is null or array_length(banned, 1) is null then
    return NEW;
  end if;

  if topic_mode = 'block' then
    foreach word in array banned loop
      if word is null or word = '' then
        continue;
      end if;
      if NEW.body ilike '%' || word || '%' then
        raise exception 'Message contains banned words';
      end if;
    end loop;
  elsif topic_mode = 'mask' then
    foreach word in array banned loop
      if word is null or word = '' then
        continue;
      end if;
      NEW.body := regexp_replace(NEW.body, word, '***', 'gi');
    end loop;
  end if;

  return NEW;
end;
$$;

drop trigger if exists discussion_moderation on public.discussion_messages;
create trigger discussion_moderation
  before insert on public.discussion_messages
  for each row execute function public.apply_topic_moderation();

-- Discussion bans (topic owner can manage)
alter table public.discussion_bans enable row level security;
drop policy if exists "Topic owner manages bans" on public.discussion_bans;
create policy "Topic owner manages bans" on public.discussion_bans
  for all
  using (exists (
    select 1 from public.discussion_topics t
    where t.id = discussion_bans.topic_id
      and t.author_id = auth.uid()
  ))
  with check (exists (
    select 1 from public.discussion_topics t
    where t.id = discussion_bans.topic_id
      and t.author_id = auth.uid()
  ));

-- Ads
alter table public.ads enable row level security;
drop policy if exists "Ads are public" on public.ads;
create policy "Ads are public" on public.ads for select using (true);
drop policy if exists "Admins manage ads" on public.ads;
create policy "Admins manage ads" on public.ads
  for all
  using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'))
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'));

-- Profiles
alter table public.profiles enable row level security;
drop policy if exists "Profiles are public" on public.profiles;
create policy "Profiles are public" on public.profiles for select using (true);
drop policy if exists "Users insert own profile" on public.profiles;
create policy "Users insert own profile" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "Users update own profile" on public.profiles;
create policy "Users update own profile" on public.profiles for update using (auth.uid() = id);

-- Friendships
alter table public.friendships enable row level security;
drop policy if exists "Users read own friendships" on public.friendships;
create policy "Users read own friendships" on public.friendships
  for select using (auth.uid() = requester_id or auth.uid() = addressee_id);
drop policy if exists "Users create friend request" on public.friendships;
create policy "Users create friend request" on public.friendships
  for insert with check (auth.uid() = requester_id);
drop policy if exists "Users update friendship" on public.friendships;
create policy "Users update friendship" on public.friendships
  for update using (auth.uid() = requester_id or auth.uid() = addressee_id);
drop policy if exists "Users delete friendship" on public.friendships;
create policy "Users delete friendship" on public.friendships
  for delete using (auth.uid() = requester_id or auth.uid() = addressee_id);

-- Direct messages
alter table public.direct_messages enable row level security;
drop policy if exists "Users read own messages" on public.direct_messages;
create policy "Users read own messages" on public.direct_messages
  for select using (auth.uid() = sender_id or auth.uid() = recipient_id);
drop policy if exists "Users send messages" on public.direct_messages;
create policy "Users send messages" on public.direct_messages
  for insert with check (auth.uid() = sender_id);

-- Post shares (publicly visible so profiles can show shares)
alter table public.post_shares enable row level security;
drop policy if exists "Post shares public" on public.post_shares;
create policy "Post shares public" on public.post_shares for select using (true);
drop policy if exists "Users insert own shares" on public.post_shares;
create policy "Users insert own shares" on public.post_shares for insert with check (auth.uid() = user_id);

-- Site settings
alter table public.site_settings enable row level security;
drop policy if exists "Settings public read" on public.site_settings;
create policy "Settings public read" on public.site_settings
  for select using (true);
drop policy if exists "Admins manage settings" on public.site_settings;
create policy "Admins manage settings" on public.site_settings
  for all
  using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'))
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'));

-- Post media gallery
alter table public.post_media enable row level security;
drop policy if exists "Post media public" on public.post_media;
create policy "Post media public" on public.post_media for select using (true);
drop policy if exists "Admins manage post media" on public.post_media;
create policy "Admins manage post media" on public.post_media
  for all
  using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'))
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'));

-- Contact/support/newsletter/ad application inboxes
alter table public.contact_requests enable row level security;
alter table public.support_requests enable row level security;
alter table public.newsletter_signups enable row level security;
alter table public.ad_applications enable row level security;

drop policy if exists "Public contact submissions" on public.contact_requests;
create policy "Public contact submissions" on public.contact_requests
  for insert with check (true);
drop policy if exists "Admins read contact" on public.contact_requests;
create policy "Admins read contact" on public.contact_requests
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'));
drop policy if exists "Admins update contact" on public.contact_requests;
create policy "Admins update contact" on public.contact_requests
  for update
  using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'))
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'));

drop policy if exists "Public support submissions" on public.support_requests;
create policy "Public support submissions" on public.support_requests
  for insert with check (true);
drop policy if exists "Admins read support" on public.support_requests;
create policy "Admins read support" on public.support_requests
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'));
drop policy if exists "Admins update support" on public.support_requests;
create policy "Admins update support" on public.support_requests
  for update
  using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'))
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'));

drop policy if exists "Public newsletter signups" on public.newsletter_signups;
create policy "Public newsletter signups" on public.newsletter_signups
  for insert with check (true);
drop policy if exists "Admins read newsletter" on public.newsletter_signups;
create policy "Admins read newsletter" on public.newsletter_signups
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'));
drop policy if exists "Admins update newsletter" on public.newsletter_signups;
create policy "Admins update newsletter" on public.newsletter_signups
  for update
  using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'))
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'));

drop policy if exists "Public ad applications" on public.ad_applications;
create policy "Public ad applications" on public.ad_applications
  for insert with check (true);
drop policy if exists "Admins read ad applications" on public.ad_applications;
create policy "Admins read ad applications" on public.ad_applications
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'));
drop policy if exists "Admins update ad applications" on public.ad_applications;
create policy "Admins update ad applications" on public.ad_applications
  for update
  using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'))
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'));

-- Chat threads & membership
alter table public.chat_threads enable row level security;
alter table public.chat_members enable row level security;

create or replace function public.is_chat_member(thread_id text, member_id uuid)
returns boolean
language plpgsql
security definer
stable
as $$
declare
  thread_uuid uuid;
begin
  if thread_id is null or member_id is null then
    return false;
  end if;
  begin
    thread_uuid := thread_id::uuid;
  exception when invalid_text_representation then
    return false;
  end;
  return exists (
    select 1
    from public.chat_members cm
    where cm.thread_id = thread_uuid
      and cm.user_id = member_id
  );
end;
$$;

drop policy if exists "Members read threads" on public.chat_threads;
create policy "Members read threads" on public.chat_threads
  for select using (
    public.is_chat_member(chat_threads.id::text, auth.uid())
  );

drop policy if exists "Users create threads" on public.chat_threads;
create policy "Users create threads" on public.chat_threads
  for insert with check (auth.uid() = created_by);

drop policy if exists "Members read chat members" on public.chat_members;
create policy "Members read chat members" on public.chat_members
  for select using (
    chat_members.user_id = auth.uid() or
    exists (
      select 1 from public.chat_threads ct
      where ct.id = chat_members.thread_id
        and (ct.created_by = auth.uid() or
          exists (
            select 1 from public.chat_members cm
            where cm.thread_id = ct.id
              and cm.user_id = auth.uid()
          ))
    )
  );

drop policy if exists "Members manage membership" on public.chat_members;
create policy "Members manage membership" on public.chat_members
  for insert with check (
    chat_members.user_id = auth.uid()
    or exists (
      select 1 from public.chat_threads
      where chat_threads.id = chat_members.thread_id
        and chat_threads.created_by = auth.uid()
    )
  );

drop policy if exists "Members update membership" on public.chat_members;
create policy "Members update membership" on public.chat_members
  for update using (
    chat_members.user_id = auth.uid()
    or exists (
      select 1 from public.chat_threads
      where chat_threads.id = chat_members.thread_id
        and chat_threads.created_by = auth.uid()
    )
  );

drop policy if exists "Members delete membership" on public.chat_members;
create policy "Members delete membership" on public.chat_members
  for delete using (
    chat_members.user_id = auth.uid()
    or exists (
      select 1 from public.chat_threads
      where chat_threads.id = chat_members.thread_id
        and chat_threads.created_by = auth.uid()
    )
  );

-- Direct messages (allow group threads)
alter table public.direct_messages enable row level security;
drop policy if exists "Users read own messages" on public.direct_messages;
create policy "Users read own messages" on public.direct_messages
  for select using (
    auth.uid() = sender_id
    or auth.uid() = recipient_id
    or public.is_chat_member(direct_messages.thread_id, auth.uid())
  );
drop policy if exists "Users send messages" on public.direct_messages;
create policy "Users send messages" on public.direct_messages
  for insert with check (
    auth.uid() = sender_id
    and (
      recipient_id is not null
      or public.is_chat_member(direct_messages.thread_id, auth.uid())
    )
  );

-- Storage policies for media bucket
alter table storage.objects enable row level security;

drop policy if exists "public_read_media" on storage.objects;
create policy "public_read_media" on storage.objects
  for select
  using (bucket_id = 'media');

-- Auth uploads for user-generated media
drop policy if exists "auth_upload_comments" on storage.objects;
create policy "auth_upload_comments" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (
      'comments',
      'discussion',
      'topics',
      'direct-messages',
      'avatars'
    )
  );

-- Curator: settings, sources, drafts
create table if not exists public.curator_settings (
  id uuid primary key,
  enabled boolean default true,
  posts_per_source int default 5,
  created_at timestamp default now(),
  updated_at timestamp
);

create table if not exists public.curator_sources (
  id uuid primary key,
  name text not null,
  source_type text not null, -- google_news_rss | gdelt
  feed_url text,
  query text,
  tags text[],
  image_credit text,
  max_items int default 30,
  enabled boolean default true,
  created_at timestamp default now(),
  updated_at timestamp
);

create table if not exists public.curator_posts (
  id uuid primary key,
  source_id uuid references public.curator_sources(id) on delete set null,
  source_name text,
  title text,
  slug text,
  excerpt text,
  content text,
  source_url text unique,
  published_at timestamp,
  tags text[],
  image_url text,
  image_source_url text,
  image_credit text,
  status text default 'draft',
  created_at timestamp default now(),
  updated_at timestamp
);

create index if not exists curator_posts_source_url_idx on public.curator_posts(source_url);
create index if not exists curator_posts_status_idx on public.curator_posts(status);
create index if not exists curator_sources_enabled_idx on public.curator_sources(enabled);

alter table public.curator_settings enable row level security;
alter table public.curator_sources enable row level security;
alter table public.curator_posts enable row level security;

drop policy if exists "Super reads curator settings" on public.curator_settings;
create policy "Super reads curator settings" on public.curator_settings
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'super');
drop policy if exists "Super manages curator settings" on public.curator_settings;
create policy "Super manages curator settings" on public.curator_settings
  for all
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'super')
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'super');

drop policy if exists "Super reads curator sources" on public.curator_sources;
create policy "Super reads curator sources" on public.curator_sources
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'super');
drop policy if exists "Super manages curator sources" on public.curator_sources;
create policy "Super manages curator sources" on public.curator_sources
  for all
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'super')
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'super');

drop policy if exists "Admins read curator drafts" on public.curator_posts;
create policy "Admins read curator drafts" on public.curator_posts
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'));
drop policy if exists "Super manages curator drafts" on public.curator_posts;
create policy "Super manages curator drafts" on public.curator_posts
  for all
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'super')
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'super');

-- Admin uploads for editorial media
drop policy if exists "admin_upload_covers" on storage.objects;
create policy "admin_upload_covers" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (
      'covers',
      'post-media',
      'ads',
      'themes'
    )
    and (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super')
  );

-- Scheduling + search for posts
alter table if exists public.posts
  add column if not exists publish_at timestamp;

alter table if exists public.posts
  add column if not exists status text default 'published';

alter table if exists public.posts
  add column if not exists search_vector tsvector;

create index if not exists posts_search_idx on public.posts using gin (search_vector);

create or replace function public.posts_search_vector_update()
returns trigger
language plpgsql
as $$
begin
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.content, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.author_name, '')), 'B') ||
    setweight(to_tsvector('english', array_to_string(coalesce(NEW.tags, '{}'::text[]), ' ')), 'C');
  return NEW;
end;
$$;

drop trigger if exists posts_search_vector_trigger on public.posts;
create trigger posts_search_vector_trigger
  before insert or update on public.posts
  for each row execute function public.posts_search_vector_update();

-- Backfill search vectors for existing posts
update public.posts
set search_vector =
  setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
  setweight(to_tsvector('english', coalesce(content, '')), 'B') ||
  setweight(to_tsvector('english', coalesce(author_name, '')), 'B') ||
  setweight(to_tsvector('english', array_to_string(coalesce(tags, '{}'::text[]), ' ')), 'C')
where search_vector is null;

-- Profile reputation + badges + notifications preferences
alter table if exists public.profiles
  add column if not exists points int default 0,
  add column if not exists level text,
  add column if not exists is_featured boolean default false,
  add column if not exists is_staff_pick boolean default false,
  add column if not exists notify_follows boolean default true,
  add column if not exists notify_mentions boolean default true;

create index if not exists profiles_points_idx on public.profiles(points);

create or replace function public.increment_profile_points(p_user_id uuid, p_delta int)
returns int
language plpgsql
security definer
as $$
declare
  updated_points int;
begin
  update public.profiles
    set points = coalesce(points, 0) + p_delta,
        updated_at = now()
  where id = p_user_id
    and auth.uid() = p_user_id
  returning points into updated_points;

  return updated_points;
end;
$$;

-- Site settings: WhatsApp + donation
alter table if exists public.site_settings
  add column if not exists support_whatsapp_number text,
  add column if not exists support_whatsapp_message text,
  add column if not exists donation_enabled boolean default false,
  add column if not exists donation_title text,
  add column if not exists donation_details text,
  add column if not exists donation_url text;

-- Admin requests
create table if not exists public.admin_requests (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  user_name text,
  message text,
  status text default 'pending',
  reviewed_by uuid,
  reviewed_at timestamp,
  created_at timestamp default now()
);

create index if not exists admin_requests_status_idx on public.admin_requests(status);

alter table public.admin_requests enable row level security;
drop policy if exists "Users create admin request" on public.admin_requests;
create policy "Users create admin request" on public.admin_requests
  for insert with check (auth.uid() = user_id);
drop policy if exists "Users read own admin request" on public.admin_requests;
create policy "Users read own admin request" on public.admin_requests
  for select using (auth.uid() = user_id);
drop policy if exists "Admins read admin requests" on public.admin_requests;
create policy "Admins read admin requests" on public.admin_requests
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'));
drop policy if exists "Super manages admin requests" on public.admin_requests;
create policy "Super manages admin requests" on public.admin_requests
  for all
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'super')
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'super');

-- Content requests
create table if not exists public.content_requests (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete set null,
  user_email text,
  user_name text,
  query text,
  status text default 'open',
  created_at timestamp default now()
);

create index if not exists content_requests_status_idx on public.content_requests(status);

alter table public.content_requests enable row level security;
drop policy if exists "Public content requests" on public.content_requests;
create policy "Public content requests" on public.content_requests
  for insert with check (true);
drop policy if exists "Admins read content requests" on public.content_requests;
create policy "Admins read content requests" on public.content_requests
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'));
drop policy if exists "Admins update content requests" on public.content_requests;
create policy "Admins update content requests" on public.content_requests
  for update
  using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'))
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'));

-- Follows
create table if not exists public.follows (
  id uuid primary key,
  follower_id uuid references auth.users(id) on delete cascade,
  target_type text not null,
  target_id uuid not null,
  created_at timestamp default now(),
  unique (follower_id, target_type, target_id)
);

create index if not exists follows_target_idx on public.follows(target_type, target_id);
alter table public.follows enable row level security;
drop policy if exists "Follows public read" on public.follows;
create policy "Follows public read" on public.follows for select using (true);
drop policy if exists "Users manage follows" on public.follows;
create policy "Users manage follows" on public.follows
  for all
  using (auth.uid() = follower_id)
  with check (auth.uid() = follower_id);

-- Bookmarks
create table if not exists public.bookmarks (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  post_id uuid references public.posts(id) on delete cascade,
  created_at timestamp default now(),
  unique (user_id, post_id)
);

alter table public.bookmarks enable row level security;
drop policy if exists "Users read bookmarks" on public.bookmarks;
create policy "Users read bookmarks" on public.bookmarks
  for select using (auth.uid() = user_id);
drop policy if exists "Users manage bookmarks" on public.bookmarks;
create policy "Users manage bookmarks" on public.bookmarks
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Notifications (in-app)
create table if not exists public.notifications (
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade,
  type text,
  title text,
  body text,
  link_url text,
  data jsonb,
  created_at timestamp default now(),
  read_at timestamp
);

create index if not exists notifications_user_idx on public.notifications(user_id);
alter table public.notifications enable row level security;
drop policy if exists "Users read notifications" on public.notifications;
create policy "Users read notifications" on public.notifications
  for select using (auth.uid() = user_id);
drop policy if exists "Users update notifications" on public.notifications;
create policy "Users update notifications" on public.notifications
  for update using (auth.uid() = user_id);
drop policy if exists "Authenticated create notifications" on public.notifications;
create policy "Authenticated create notifications" on public.notifications
  for insert with check (auth.uid() is not null);
-- Novels (serialized fiction)
create table if not exists public.novels (
  id uuid primary key,
  author_id uuid not null references auth.users(id) on delete cascade,
  author_name text not null,
  title text not null,
  synopsis text,
  genre text,
  status text not null default 'ongoing', -- ongoing, completed, paused
  cover_url text,
  tags text[] default '{}'::text[],
  chapters_count integer default 0,
  views integer default 0,
  likes integer default 0,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

create index if not exists novels_author_idx on public.novels(author_id);
create index if not exists novels_status_idx on public.novels(status);
create index if not exists novels_created_idx on public.novels(created_at);

alter table public.novels enable row level security;
drop policy if exists "Novels public read" on public.novels;
create policy "Novels public read" on public.novels for select using (true);
drop policy if exists "Authors manage novels" on public.novels;
create policy "Authors manage novels" on public.novels
  for all
  using (auth.uid() = author_id)
  with check (auth.uid() = author_id);

-- Chapters (parts of novels)
create table if not exists public.chapters (
  id uuid primary key,
  novel_id uuid not null references public.novels(id) on delete cascade,
  chapter_number integer not null,
  title text not null,
  content text not null,
  word_count integer default 0,
  published boolean default true,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

create index if not exists chapters_novel_idx on public.chapters(novel_id);
create index if not exists chapters_number_idx on public.chapters(novel_id, chapter_number);

alter table public.chapters enable row level security;
drop policy if exists "Chapters public read" on public.chapters;
create policy "Chapters public read" on public.chapters for select using (true);
drop policy if exists "Chapter authors manage" on public.chapters;
create policy "Chapter authors manage" on public.chapters
  for all
  using (auth.uid() = (select author_id from public.novels where id = novel_id))
  with check (auth.uid() = (select author_id from public.novels where id = novel_id));

-- Novel likes
create table if not exists public.novel_likes (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  novel_id uuid not null references public.novels(id) on delete cascade,
  created_at timestamp default now(),
  unique (user_id, novel_id)
);

create index if not exists novel_likes_user_idx on public.novel_likes(user_id);
create index if not exists novel_likes_novel_idx on public.novel_likes(novel_id);

alter table public.novel_likes enable row level security;
drop policy if exists "Novel likes public read" on public.novel_likes;
create policy "Novel likes public read" on public.novel_likes for select using (true);
drop policy if exists "Users manage likes" on public.novel_likes;
create policy "Users manage likes" on public.novel_likes
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Novel subscriptions
create table if not exists public.novel_subscriptions (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  novel_id uuid not null references public.novels(id) on delete cascade,
  created_at timestamp default now(),
  unique (user_id, novel_id)
);

create index if not exists novel_subs_user_idx on public.novel_subscriptions(user_id);
create index if not exists novel_subs_novel_idx on public.novel_subscriptions(novel_id);

alter table public.novel_subscriptions enable row level security;
drop policy if exists "Subscriptions user access" on public.novel_subscriptions;
create policy "Subscriptions user access" on public.novel_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);