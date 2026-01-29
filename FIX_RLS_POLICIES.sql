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
-- VERIFY ADMIN USER ROLE
-- Run this query to check if your admin account has proper role:
-- ============================================================

-- SELECT 
--   id,
--   email,
--   user_metadata ->> 'role' as role_in_jwt,
--   (SELECT role FROM profiles WHERE id = auth.users.id) as role_in_db
-- FROM auth.users
-- WHERE email = 'your-admin-email@example.com';

-- If the admin user doesn't have a profile record, insert it:
-- INSERT INTO profiles (id, email, display_name, username, role)
-- SELECT 
--   id,
--   email,
--   COALESCE(user_metadata->>'display_name', 'Admin'),
--   COALESCE(user_metadata->>'username', split_part(email, '@', 1)),
--   'admin'
-- FROM auth.users
-- WHERE email = 'your-admin-email@example.com'
-- AND id NOT IN (SELECT id FROM profiles);
