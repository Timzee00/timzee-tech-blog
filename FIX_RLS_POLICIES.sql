-- ============================================================
-- FIX RLS POLICIES FOR STORAGE AND TABLE ACCESS
-- Run this in Supabase SQL Editor if uploads are failing
-- ============================================================

-- ============================================================
-- STORAGE POLICIES - Media Bucket
-- ============================================================

-- 1. Public read access for all media
drop policy if exists "public_read_media" on storage.objects;
create policy "public_read_media" on storage.objects
  for select
  using (bucket_id = 'media');

-- 2. Authenticated users can upload to user folders (comments, discussions, etc.)
drop policy if exists "auth_upload_user_media" on storage.objects;
create policy "auth_upload_user_media" on storage.objects
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

-- 3. Admins and super admins can upload to admin folders
drop policy if exists "admin_upload_admin_media" on storage.objects;
create policy "admin_upload_admin_media" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] in (
      'covers',
      'post-media',
      'ads',
      'themes',
      'videos'
    )
    and (
      (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super')
      or auth.uid() in (
        select id from profiles where role in ('admin','super')
      )
    )
  );

-- ============================================================
-- TABLE RLS POLICIES - Relaxed for authenticated users
-- ============================================================

-- Announcements table
drop policy if exists "Announcements are public" on public.announcements;
create policy "Announcements are public" on public.announcements
  for select
  using (true);

drop policy if exists "Admins create announcements" on public.announcements;
create policy "Admins create announcements" on public.announcements
  for insert to authenticated
  with check (
    (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super')
    or auth.uid() in (
      select id from profiles where role in ('admin','super')
    )
  );

drop policy if exists "Admins update announcements" on public.announcements;
create policy "Admins update announcements" on public.announcements
  for update to authenticated
  using (
    (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super')
    or auth.uid() in (
      select id from profiles where role in ('admin','super')
    )
  )
  with check (
    (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super')
    or auth.uid() in (
      select id from profiles where role in ('admin','super')
    )
  );

drop policy if exists "Admins delete announcements" on public.announcements;
create policy "Admins delete announcements" on public.announcements
  for delete to authenticated
  using (
    (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super')
    or auth.uid() in (
      select id from profiles where role in ('admin','super')
    )
  );

-- Curator Sources
drop policy if exists "Super/Admin read curator sources" on public.curator_sources;
create policy "Super/Admin read curator sources" on public.curator_sources
  for select to authenticated
  using (
    (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super')
    or auth.uid() in (
      select id from profiles where role in ('admin','super')
    )
  );

drop policy if exists "Super/Admin manage curator sources" on public.curator_sources;
create policy "Super/Admin manage curator sources" on public.curator_sources
  for all to authenticated
  using (
    (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super')
    or auth.uid() in (
      select id from profiles where role in ('admin','super')
    )
  )
  with check (
    (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super')
    or auth.uid() in (
      select id from profiles where role in ('admin','super')
    )
  );

-- Curator Posts
drop policy if exists "Super/Admin read curator posts" on public.curator_posts;
create policy "Super/Admin read curator posts" on public.curator_posts
  for select to authenticated
  using (
    (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super')
    or auth.uid() in (
      select id from profiles where role in ('admin','super')
    )
  );

drop policy if exists "Super/Admin manage curator posts" on public.curator_posts;
create policy "Super/Admin manage curator posts" on public.curator_posts
  for all to authenticated
  using (
    (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super')
    or auth.uid() in (
      select id from profiles where role in ('admin','super')
    )
  )
  with check (
    (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super')
    or auth.uid() in (
      select id from profiles where role in ('admin','super')
    )
  );

-- Curator Settings
drop policy if exists "Super/Admin read curator settings" on public.curator_settings;
create policy "Super/Admin read curator settings" on public.curator_settings
  for select to authenticated
  using (
    (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super')
    or auth.uid() in (
      select id from profiles where role in ('admin','super')
    )
  );

drop policy if exists "Super/Admin manage curator settings" on public.curator_settings;
create policy "Super/Admin manage curator settings" on public.curator_settings
  for all to authenticated
  using (
    (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super')
    or auth.uid() in (
      select id from profiles where role in ('admin','super')
    )
  )
  with check (
    (auth.jwt() -> 'user_metadata' ->> 'role') in ('admin','super')
    or auth.uid() in (
      select id from profiles where role in ('admin','super')
    )
  );

-- ============================================================
-- VERIFY ADMIN USER ROLE (Safer checks)
-- Run these queries to inspect role information. Some Supabase deployments store metadata in
-- `raw_user_meta_data` instead of `user_metadata`, so we try both and fall back to the `profiles` table.
-- ============================================================

-- 1) Inspect a user's role from auth (fall back to raw_user_meta_data then user_metadata)
-- Replace the email and run without the default 100-row limit (use "No limit" in the SQL editor)
SELECT
  id,
  email,
  COALESCE(
    (raw_user_meta_data ->> 'role'),
    (user_metadata ->> 'role')
  ) AS role_in_jwt,
  (SELECT role FROM profiles WHERE id = auth.users.id) AS role_in_db
FROM auth.users
WHERE email = 'your-admin-email@example.com';

-- 2) If the admin user doesn't have a profile record, create one (use only if needed)
-- Replace the email and run once
-- INSERT INTO profiles (id, email, display_name, username, role)
-- SELECT
--   id,
--   email,
--   COALESCE(raw_user_meta_data->>'display_name', user_metadata->>'display_name', 'Admin'),
--   COALESCE(raw_user_meta_data->>'username', user_metadata->>'username', split_part(email, '@', 1)),
--   'admin'
-- FROM auth.users
-- WHERE email = 'your-admin-email@example.com'
-- AND id NOT IN (SELECT id FROM profiles);

-- 3) Guarded migrations: add/populate compatibility columns for curator_sources
-- These blocks check for column existence before altering or updating to avoid "column does not exist" errors.
DO $$
BEGIN
  -- Add 'is_active' if it doesn't exist
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'curator_sources' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.curator_sources ADD COLUMN is_active boolean DEFAULT true;
  END IF;

  -- If there is an old 'enabled' column, copy values safely
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'curator_sources' AND column_name = 'enabled'
  ) THEN
    EXECUTE 'UPDATE public.curator_sources SET is_active = enabled WHERE is_active IS NULL AND enabled IS NOT NULL';
  END IF;
END
$$;

DO $$
BEGIN
  -- Add 'feed_url' if missing and copy from 'url' if present
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'curator_sources' AND column_name = 'feed_url'
  ) THEN
    ALTER TABLE public.curator_sources ADD COLUMN feed_url text;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'curator_sources' AND column_name = 'url'
  ) THEN
    EXECUTE 'UPDATE public.curator_sources SET feed_url = url WHERE feed_url IS NULL AND url IS NOT NULL';
  END IF;
END
$$;

-- Note: If you see a syntax error related to row limits in the SQL editor, try re-running the SELECT with "No limit".


-- ============================================================
-- FAQ TABLE - used by public Support page and admin CRUD
-- ============================================================
create table if not exists public.faqs (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  answer text not null,
  category text,
  is_published boolean default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamp default now(),
  updated_at timestamp
);

create index if not exists faqs_published_idx on public.faqs(is_published);

alter table public.faqs enable row level security;

drop policy if exists "Public read faqs" on public.faqs;
create policy "Public read faqs" on public.faqs
  for select
  using (is_published = true);

drop policy if exists "Admins manage faqs" on public.faqs;
create policy "Admins manage faqs" on public.faqs
  for all to authenticated
  using (
    -- Prefer roles from the profiles table to avoid JSON/auth.jwt() parsing issues
    auth.uid() in (select id from profiles where role in ('admin','super'))
  )
  with check (
    auth.uid() in (select id from profiles where role in ('admin','super'))
  );

-- Sample FAQ rows
insert into public.faqs (question, answer, category)
values
('How do I become an author?', 'Request promotion via the Admin panel. Admins and moderators can promote authors.', 'Authors'),
('How to report abusive content?', 'Use the report button on a post or contact support@timzeetechhub.com', 'Moderation')
on conflict do nothing;
