-- Separate private story media from the publicly readable "media" bucket.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES(
 'story-private-media','story-private-media',false,52428800,
 ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
       'video/mp4','video/webm','video/quicktime']
)
ON CONFLICT(id) DO UPDATE SET
 public=false,
 file_size_limit=EXCLUDED.file_size_limit,
 allowed_mime_types=EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "story_private_owner_insert" ON storage.objects;
CREATE POLICY "story_private_owner_insert" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
 bucket_id='story-private-media'
 AND (storage.foldername(name))[1]=(select auth.uid())::text
);
DROP POLICY IF EXISTS "story_private_owner_select" ON storage.objects;
CREATE POLICY "story_private_owner_select" ON storage.objects FOR SELECT TO authenticated
USING(
 bucket_id='story-private-media'
 AND (storage.foldername(name))[1]=(select auth.uid())::text
);
DROP POLICY IF EXISTS "story_private_owner_delete" ON storage.objects;
CREATE POLICY "story_private_owner_delete" ON storage.objects FOR DELETE TO authenticated
USING(
 bucket_id='story-private-media'
 AND (storage.foldername(name))[1]=(select auth.uid())::text
);
