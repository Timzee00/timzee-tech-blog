-- Private cross-device reading continuity. No public view history or
-- engagement manipulation; all data is owned by the signed-in reader.
CREATE TABLE IF NOT EXISTS public.article_reading_progress (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  progress_percent smallint NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
  last_read_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  PRIMARY KEY (user_id,post_id)
);
CREATE INDEX IF NOT EXISTS article_reading_resume_idx
 ON public.article_reading_progress(user_id,last_read_at DESC)
 WHERE completed_at IS NULL;
ALTER TABLE public.article_reading_progress ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.article_reading_progress FROM PUBLIC,anon,authenticated;
GRANT SELECT,DELETE ON public.article_reading_progress TO authenticated;
DROP POLICY IF EXISTS article_reading_owner_read ON public.article_reading_progress;
CREATE POLICY article_reading_owner_read ON public.article_reading_progress
 FOR SELECT TO authenticated USING (user_id=(SELECT auth.uid()));
DROP POLICY IF EXISTS article_reading_owner_delete ON public.article_reading_progress;
CREATE POLICY article_reading_owner_delete ON public.article_reading_progress
 FOR DELETE TO authenticated USING (user_id=(SELECT auth.uid()));

-- Only the controlled RPC can write progress; clients cannot forge another
-- user's history or create records for private/unpublished drafts.
CREATE OR REPLACE FUNCTION public.record_article_reading(
 p_post_id uuid,p_percent integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public
AS $function$
DECLARE v_user uuid:=auth.uid();v_updated integer:=0;
BEGIN
 IF v_user IS NULL THEN RAISE EXCEPTION 'Sign in to save reading progress'
   USING ERRCODE='42501'; END IF;
 IF p_post_id IS NULL OR p_percent IS NULL OR p_percent NOT BETWEEN 1 AND 100 THEN
   RAISE EXCEPTION 'Invalid reading progress' USING ERRCODE='22023';
 END IF;
 -- Respect the server-saved privacy preference, including a device with
 -- stale local settings. Absence of the setting means the default is enabled.
 IF EXISTS (SELECT 1 FROM public.user_settings s WHERE s.user_id=v_user
   AND s.preferences#>>'{privacy,rememberReading}'='false') THEN
   RETURN false;
 END IF;
 IF NOT EXISTS (
  SELECT 1 FROM public.posts p WHERE p.id=p_post_id AND p.status='published'
    AND (p.publish_at IS NULL OR p.publish_at <= (now() AT TIME ZONE 'UTC'))
 ) THEN RETURN false; END IF;
 INSERT INTO public.article_reading_progress
  (user_id,post_id,progress_percent,last_read_at,completed_at)
 VALUES
  (v_user,p_post_id,p_percent,now(),
   CASE WHEN p_percent>=95 THEN now() ELSE NULL END)
 ON CONFLICT (user_id,post_id) DO UPDATE SET
   progress_percent=greatest(public.article_reading_progress.progress_percent,
      EXCLUDED.progress_percent),
   last_read_at=now(),
   completed_at=coalesce(public.article_reading_progress.completed_at,EXCLUDED.completed_at)
 WHERE public.article_reading_progress.completed_at IS NULL
   AND (now()-public.article_reading_progress.last_read_at >= interval '20 seconds'
     OR EXCLUDED.progress_percent>=public.article_reading_progress.progress_percent+5
     OR EXCLUDED.completed_at IS NOT NULL);
 GET DIAGNOSTICS v_updated=ROW_COUNT;
 RETURN v_updated>0;
END
$function$;
REVOKE ALL ON FUNCTION public.record_article_reading(uuid,integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_article_reading(uuid,integer) TO authenticated;

-- Single set-based, RLS-respecting "Fresh from people you follow" feed.
-- Existing follows.target_id is TEXT while posts.author_id is UUID.
CREATE INDEX IF NOT EXISTS follows_reader_author_lookup_idx
 ON public.follows(follower_id,target_type,target_id)
 WHERE target_type='author';
CREATE INDEX IF NOT EXISTS posts_following_recent_idx
 ON public.posts(created_at DESC,author_id)
 WHERE status='published';

CREATE OR REPLACE FUNCTION public.reader_following_articles(p_limit integer DEFAULT 6)
RETURNS TABLE(
 post_id uuid,title text,slug text,cover text,author_id uuid,
 author_name text,created_at timestamp without time zone,content_type text
)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public
AS $function$
 SELECT p.id,p.title,p.slug,p.cover,p.author_id,p.author_name,p.created_at,p.content_type
 FROM public.posts p
 WHERE (SELECT auth.uid()) IS NOT NULL
   AND p.status='published'
   AND (p.publish_at IS NULL OR p.publish_at <= (now() AT TIME ZONE 'UTC'))
   AND p.author_id IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM public.follows f
     WHERE f.follower_id=(SELECT auth.uid())
       AND f.target_type='author' AND f.target_id=p.author_id::text
   )
 ORDER BY p.created_at DESC,p.id DESC
 LIMIT greatest(1,least(coalesce(p_limit,6),12))
$function$;
REVOKE ALL ON FUNCTION public.reader_following_articles(integer)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reader_following_articles(integer)
 TO authenticated;
