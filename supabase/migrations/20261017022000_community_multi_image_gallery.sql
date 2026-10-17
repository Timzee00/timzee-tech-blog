
-- Multiple images per topic, with strict owner media scope.
CREATE TABLE IF NOT EXISTS public.community_thread_media(
 thread_id uuid NOT NULL REFERENCES public.community_threads(id) ON DELETE CASCADE,
 position smallint NOT NULL CHECK(position BETWEEN 0 AND 5),
 media_url text NOT NULL CHECK(length(media_url)<=1400),
 media_type text NOT NULL CHECK(media_type IN ('image','video')),
 added_by uuid NOT NULL REFERENCES auth.users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(thread_id,position)
);
CREATE INDEX IF NOT EXISTS community_thread_media_creator ON public.community_thread_media(added_by,created_at DESC);
ALTER TABLE public.community_thread_media ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_thread_media FROM anon,authenticated;
GRANT SELECT ON public.community_thread_media TO anon,authenticated;
GRANT INSERT ON public.community_thread_media TO authenticated;
CREATE POLICY community_thread_media_read ON public.community_thread_media FOR SELECT TO anon,authenticated
USING(EXISTS(SELECT 1 FROM public.community_threads t
 WHERE t.id=thread_id AND public.community_can_read(t.community_id,auth.uid())
 AND(t.status='published' OR t.author_id=auth.uid()
 OR public.community_is_moderator(t.community_id,auth.uid()))));
CREATE POLICY community_thread_media_insert ON public.community_thread_media FOR INSERT TO authenticated
WITH CHECK(added_by=auth.uid() AND EXISTS(
 SELECT 1 FROM public.community_threads t WHERE t.id=thread_id AND t.author_id=auth.uid()
 AND t.status='published'
));
CREATE OR REPLACE FUNCTION public.community_thread_gallery_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_prefix text;v_count integer;
BEGIN
 v_prefix='https://duvbcwwprkzzyzikmcol.supabase.co/storage/v1/object/public/media/community-threads/'
 ||auth.uid()::text||'/';
 IF new.added_by IS DISTINCT FROM auth.uid() OR new.media_url NOT LIKE v_prefix||'%'
  OR new.media_url ~ '[?#]' OR new.media_url LIKE '%..%' THEN
  RAISE EXCEPTION 'Gallery images must belong to the publishing account' USING ERRCODE='42501';
 END IF;
 IF new.media_type='video' AND new.position>0 THEN
  RAISE EXCEPTION 'Video must be the only attachment' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM public.community_thread_media existing
   WHERE existing.thread_id=new.thread_id AND
     (existing.media_type='video' OR new.media_type='video')) THEN
  RAISE EXCEPTION 'Video cannot be mixed with other attachments' USING ERRCODE='22023';
 END IF;
 RETURN new;
END $$;
CREATE TRIGGER community_gallery_guard BEFORE INSERT ON public.community_thread_media
FOR EACH ROW EXECUTE FUNCTION public.community_thread_gallery_guard();
