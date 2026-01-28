-- New Tables for Moderator System and Curator Bot
-- Run this file in your Supabase SQL editor after the main SUPABASE_SCHEMA.sql

-- ============================================================
-- CLEANUP (Remove if tables exist from failed attempts)
-- ============================================================
drop table if exists public.moderators cascade;
drop table if exists public.authors cascade;
drop table if exists public.curator_posts cascade;
drop table if exists public.curator_sources cascade;
drop table if exists public.curator_settings cascade;

-- ============================================================
-- MODERATOR ROLE SYSTEM
-- ============================================================

-- Moderators (role management between super admin and admin)
-- Moderators can manage authors and moderate content
create table if not exists public.moderators (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  username text,
  full_name text,
  email text,
  permissions text[] default ARRAY['manage_authors','manage_posts','moderate_comments'],
  promoted_by uuid references auth.users(id) on delete set null,
  promoted_at timestamp default now(),
  is_active boolean default true,
  created_at timestamp default now(),
  notes text
);

create index if not exists moderators_user_idx on public.moderators(user_id);
create index if not exists moderators_active_idx on public.moderators(is_active);

alter table public.moderators enable row level security;
drop policy if exists "Super admins manage moderators" on public.moderators;
create policy "Super admins manage moderators" on public.moderators
  for all
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'super');
drop policy if exists "Moderators see own profile" on public.moderators;
create policy "Moderators see own profile" on public.moderators
  for select using (auth.uid() = user_id);

-- Authors (users promoted to post content)
-- Authors are regular users who have posting rights
create table if not exists public.authors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users(id) on delete cascade,
  username text,
  full_name text,
  email text,
  bio text,
  avatar_url text,
  post_count integer default 0,
  promoted_by uuid references auth.users(id) on delete set null,
  promoted_at timestamp default now(),
  is_active boolean default true,
  created_at timestamp default now(),
  notes text
);

create index if not exists authors_user_idx on public.authors(user_id);
create index if not exists authors_active_idx on public.authors(is_active);

alter table public.authors enable row level security;
drop policy if exists "Admins manage authors" on public.authors;
create policy "Admins manage authors" on public.authors
  for all
  using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super','moderator'));
drop policy if exists "Authors see self" on public.authors;
create policy "Authors see self" on public.authors
  for select using (auth.uid() = user_id or (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super','moderator'));

-- ============================================================
-- CURATOR BOT TABLES
-- ============================================================

-- Curator sources (RSS feeds or content sources)
-- Configure which sources the bot should monitor
create table if not exists public.curator_sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  url text unique not null,
  source_type text default 'rss', -- rss, api, webhook
  description text,
  category text,
  is_active boolean default true,
  last_fetched_at timestamp,
  fetch_frequency_minutes integer default 60,
  api_key text,
  headers jsonb default '{}',
  filter_keywords text[] default ARRAY[]::text[],
  exclude_keywords text[] default ARRAY[]::text[],
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp default now(),
  updated_at timestamp
);

create index if not exists curator_sources_active_idx on public.curator_sources(is_active);
create index if not exists curator_sources_type_idx on public.curator_sources(source_type);
create index if not exists curator_sources_last_fetch_idx on public.curator_sources(last_fetched_at);

alter table public.curator_sources enable row level security;
drop policy if exists "Admins read sources" on public.curator_sources;
create policy "Admins read sources" on public.curator_sources
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super','moderator'));
drop policy if exists "Admins manage sources" on public.curator_sources;
create policy "Admins manage sources" on public.curator_sources
  for all
  using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'))
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'));

-- Curator posts (for RSS bot to store fetched articles)
-- Bot stores all fetched articles here before posting
create table if not exists public.curator_posts (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.curator_sources(id) on delete cascade,
  title text not null,
  description text,
  content text,
  url text unique,
  author text,
  published_at timestamp,
  fetched_at timestamp default now(),
  image_url text,
  tags text[] default ARRAY[]::text[],
  is_posted boolean default false,
  post_id uuid references public.posts(id) on delete set null,
  created_at timestamp default now()
);

create index if not exists curator_posts_source_idx on public.curator_posts(source_id);
create index if not exists curator_posts_is_posted_idx on public.curator_posts(is_posted);
create index if not exists curator_posts_published_idx on public.curator_posts(published_at);

alter table public.curator_posts enable row level security;
drop policy if exists "Admins read curator posts" on public.curator_posts;
create policy "Admins read curator posts" on public.curator_posts
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super','moderator'));
drop policy if exists "Admins manage curator posts" on public.curator_posts;
create policy "Admins manage curator posts" on public.curator_posts
  for all
  using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super','moderator'))
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super','moderator'));

-- Curator settings (global bot configuration)
-- Single row with bot configuration
create table if not exists public.curator_settings (
  id uuid primary key default gen_random_uuid(),
  site_name text default 'Timzee Tech Hub',
  api_key text not null,
  auto_post boolean default false,
  auto_post_hour integer default 9, -- 0-23 hours
  min_quality_score integer default 60, -- 0-100
  duplicate_check boolean default true,
  notify_admins boolean default true,
  max_posts_per_day integer default 5,
  created_at timestamp default now(),
  updated_at timestamp default now()
);

alter table public.curator_settings enable row level security;
drop policy if exists "Admins read curator settings" on public.curator_settings;
create policy "Admins read curator settings" on public.curator_settings
  for select using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super'));
drop policy if exists "Only super admin writes curator" on public.curator_settings;
create policy "Only super admin writes curator" on public.curator_settings
  for all
  using ((auth.jwt() -> 'user_metadata' ->> 'role') = 'super')
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') = 'super');

-- ============================================================
-- GRANT MODERATORS POSTING ACCESS
-- ============================================================
-- Add RLS policy to allow moderators to create/edit/delete posts

alter table if exists public.posts enable row level security;

-- Moderators can create posts (like authors)
drop policy if exists "Moderators can create posts" on public.posts;
create policy "Moderators can create posts" on public.posts
  for insert 
  with check (
    auth.uid() = author_id 
    or exists (select 1 from public.moderators where user_id = auth.uid() and is_active = true)
  );

-- Moderators can edit their own posts
drop policy if exists "Moderators can edit posts" on public.posts;
create policy "Moderators can edit posts" on public.posts
  for update
  using (
    auth.uid() = author_id
    or exists (select 1 from public.moderators where user_id = auth.uid() and is_active = true)
  );

-- Moderators can delete any post
drop policy if exists "Moderators can delete posts" on public.posts;
create policy "Moderators can delete posts" on public.posts
  for delete
  using (
    auth.uid() = author_id
    or exists (select 1 from public.moderators where user_id = auth.uid() and is_active = true)
  );

-- ============================================================
-- INSERT DEFAULT CURATOR SETTINGS (Run once)
-- ============================================================
-- Insert a default row if not exists
INSERT INTO public.curator_settings (api_key) 
VALUES (gen_random_uuid()::text)
ON CONFLICT DO NOTHING;

-- ============================================================
-- STAFF PICK FEATURE (Featured Posts)
-- ============================================================
-- Add staff pick columns to posts table
alter table if exists public.posts
  add column if not exists is_staff_pick boolean default false,
  add column if not exists staff_pick_reason text,
  add column if not exists staff_picked_at timestamp,
  add column if not exists staff_picked_by uuid references auth.users(id) on delete set null;

-- Create index for quick filtering
create index if not exists posts_staff_pick_idx on public.posts(is_staff_pick, created_at);

-- RLS policy: Only admins/moderators/super can set staff pick
drop policy if exists "Admins set staff pick" on public.posts;
create policy "Admins set staff pick" on public.posts
  for update
  using ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super','moderator'))
  with check ((auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super','moderator'));
