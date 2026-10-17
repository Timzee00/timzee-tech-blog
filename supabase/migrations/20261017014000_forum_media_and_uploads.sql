
-- Preserve media from pre-forum community topics in their migrated threads.
ALTER TABLE public.community_threads
 ADD COLUMN IF NOT EXISTS media_url text,
 ADD COLUMN IF NOT EXISTS media_type text;
UPDATE public.community_threads t SET media_url=old.media_url,media_type=old.media_type
FROM public.community_legacy_redirects redirects
JOIN public.discussion_topics old ON old.id=redirects.old_topic_id
WHERE t.id=redirects.thread_id AND t.media_url IS NULL AND old.media_url IS NOT NULL;

DROP POLICY IF EXISTS auth_upload_own_community_media ON storage.objects;
CREATE POLICY auth_upload_own_community_media ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='media' AND (storage.foldername(name))[1] IN
 ('community-threads','community-replies')
 AND (storage.foldername(name))[2]=(SELECT auth.uid())::text);

-- Avoid allowing a creator to attach media from another member's account.
CREATE OR REPLACE FUNCTION public.community_media_owner_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_prefix text;
BEGIN
 IF new.media_url IS NULL THEN RETURN new; END IF;
 v_prefix='https://duvbcwwprkzzyzikmcol.supabase.co/storage/v1/object/public/media/community-threads/'
   ||auth.uid()::text||'/';
 IF new.media_url NOT LIKE v_prefix||'%' OR new.media_url LIKE '%..%'
    OR new.media_url ~ '[?#]' OR length(new.media_url)>1400 THEN
    RAISE EXCEPTION 'Choose an attachment from your own forum uploads'
    USING ERRCODE='42501';
 END IF;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS forum_media_owner_guard ON public.community_threads;
CREATE TRIGGER forum_media_owner_guard BEFORE INSERT ON public.community_threads FOR EACH ROW
EXECUTE FUNCTION public.community_media_owner_guard();
