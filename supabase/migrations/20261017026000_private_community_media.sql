
-- Never put attachments from member-only communities in a public bucket.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('forum-private-media','forum-private-media',false,12582912,
 ARRAY['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=12582912,
allowed_mime_types=EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS "forum_private_upload" ON storage.objects;
CREATE POLICY "forum_private_upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='forum-private-media' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
DROP POLICY IF EXISTS "forum_private_owner_read" ON storage.objects;
CREATE POLICY "forum_private_owner_read" ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='forum-private-media' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
DROP POLICY IF EXISTS "forum_private_owner_delete" ON storage.objects;
CREATE POLICY "forum_private_owner_delete" ON storage.objects FOR DELETE TO authenticated
USING(bucket_id='forum-private-media' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);

CREATE OR REPLACE FUNCTION public.community_media_owner_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_prefix text;v_visibility text;
BEGIN
 IF new.media_url IS NULL THEN RETURN new; END IF;
 SELECT c.visibility INTO v_visibility FROM public.discussion_topics c WHERE c.id=new.community_id;
 IF v_visibility='public' THEN
  v_prefix='https://duvbcwwprkzzyzikmcol.supabase.co/storage/v1/object/public/media/community-threads/'||auth.uid()::text||'/';
 ELSE
  v_prefix='forum-private-media/'||auth.uid()::text||'/threads/';
 END IF;
 IF new.media_url NOT LIKE v_prefix||'%' OR new.media_url LIKE '%..%'
  OR new.media_url ~ '[?#]' OR length(new.media_url)>1400 THEN
  RAISE EXCEPTION 'Attachments must use secure owner storage for this community'
  USING ERRCODE='42501';
 END IF;
 RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.community_thread_gallery_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_prefix text;v_visibility text;
BEGIN
 SELECT c.visibility INTO v_visibility FROM public.community_threads t
 JOIN public.discussion_topics c ON c.id=t.community_id WHERE t.id=new.thread_id;
 IF v_visibility='public' THEN
  v_prefix='https://duvbcwwprkzzyzikmcol.supabase.co/storage/v1/object/public/media/community-threads/'||auth.uid()::text||'/';
 ELSE
  v_prefix='forum-private-media/'||auth.uid()::text||'/threads/';
 END IF;
 IF new.added_by IS DISTINCT FROM auth.uid() OR new.media_url NOT LIKE v_prefix||'%'
 OR new.media_url LIKE '%..%' OR new.media_url ~ '[?#]' THEN
  RAISE EXCEPTION 'Photo must be stored privately when community is restricted'
   USING ERRCODE='42501';
 END IF;
 IF new.media_type='video' AND new.position>0 THEN
  RAISE EXCEPTION 'Video must be the only attachment' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM public.community_thread_media existing
 WHERE existing.thread_id=new.thread_id AND
 (existing.media_type='video' OR new.media_type='video')) THEN
  RAISE EXCEPTION 'Video cannot mix with other attachments' USING ERRCODE='22023';
 END IF;
 RETURN new;
END $$;

CREATE OR REPLACE FUNCTION public.forum_reply_media_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_prefix text;v_visibility text;v_old_room boolean;
BEGIN
 IF new.media_url IS NULL THEN RETURN new; END IF;
 SELECT EXISTS(SELECT 1 FROM public.community_legacy_redirects map
  WHERE map.old_topic_id=new.topic_id AND map.thread_id=new.thread_id) INTO v_old_room;
 IF v_old_room THEN RETURN new; END IF;
 SELECT c.visibility INTO v_visibility FROM public.community_threads t
 JOIN public.discussion_topics c ON c.id=t.community_id WHERE t.id=new.thread_id;
 IF v_visibility='public' THEN
  v_prefix='https://duvbcwwprkzzyzikmcol.supabase.co/storage/v1/object/public/media/community-replies/'||auth.uid()::text||'/';
 ELSE
  v_prefix='forum-private-media/'||auth.uid()::text||'/replies/';
 END IF;
 IF new.media_url NOT LIKE v_prefix||'%' OR new.media_url LIKE '%..%'
  OR new.media_url ~ '[?#]' OR length(new.media_url)>1400 THEN
  RAISE EXCEPTION 'Attachments must belong to the author and use proper privacy storage'
   USING ERRCODE='42501';
 END IF;
 RETURN new;
END $$;
