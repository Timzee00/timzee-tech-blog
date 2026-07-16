-- ============================================================
-- Video Storage RLS Migration
-- Purpose:
--   Allow authenticated users to upload/delete only their own
--   video files under:
--     media/videos/<userId>/...
--     media/video-thumbnails/<userId>/...
-- Notes:
--   - This migration does NOT remove or weaken existing admin policies.
--   - Existing public read policies can remain unchanged.
-- ============================================================

alter table if exists storage.objects enable row level security;

drop policy if exists "auth_upload_own_video_media" on storage.objects;
create policy "auth_upload_own_video_media" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'media'
    and (
      (
        (storage.foldername(name))[1] = 'videos'
        and (storage.foldername(name))[2] = auth.uid()::text
      )
      or
      (
        (storage.foldername(name))[1] = 'video-thumbnails'
        and (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  );

drop policy if exists "auth_delete_own_video_media" on storage.objects;
create policy "auth_delete_own_video_media" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'media'
    and (
      (
        (storage.foldername(name))[1] = 'videos'
        and (storage.foldername(name))[2] = auth.uid()::text
      )
      or
      (
        (storage.foldername(name))[1] = 'video-thumbnails'
        and (storage.foldername(name))[2] = auth.uid()::text
      )
    )
  );
