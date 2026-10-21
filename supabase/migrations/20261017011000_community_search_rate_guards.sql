-- Indexed full-text search and hard limits for community thread creation.
ALTER TABLE public.community_threads
 ADD COLUMN IF NOT EXISTS search_vector tsvector
 GENERATED ALWAYS AS (to_tsvector('english',coalesce(title,'')||' '||coalesce(body,''))) STORED;
CREATE INDEX IF NOT EXISTS community_thread_search_gin
 ON public.community_threads USING gin(search_vector);
CREATE INDEX IF NOT EXISTS community_thread_author_time
 ON public.community_threads(author_id,created_at DESC);
CREATE OR REPLACE FUNCTION public.enforce_community_thread_submission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_count integer;v_staff boolean;
BEGIN
 IF auth.uid() IS NULL OR new.author_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Sign in to publish topics' USING ERRCODE='42501';
 END IF;
 IF new.is_pinned OR new.is_locked OR new.is_legacy_room OR new.status<>'published' THEN
  RAISE EXCEPTION 'Only moderators may manage thread states' USING ERRCODE='42501';
 END IF;
 SELECT EXISTS(SELECT 1 FROM public.community_members m
  WHERE m.community_id=new.community_id AND m.user_id=auth.uid()
    AND m.role IN ('owner','moderator')) INTO v_staff;
 IF new.kind='announcement' AND NOT v_staff THEN
  RAISE EXCEPTION 'Only community staff may publish official announcements' USING ERRCODE='42501';
 END IF;
 IF NOT v_staff THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,4922));
  SELECT count(*) INTO v_count FROM public.community_threads t
  WHERE t.author_id=auth.uid() AND t.created_at>now()-interval '1 hour';
  IF v_count>=10 THEN
   RAISE EXCEPTION 'You have reached the hourly topic limit' USING ERRCODE='22023';
  END IF;
 END IF;
 new.created_at:=now();new.updated_at:=now();new.last_activity_at:=now();
 new.reply_count:=0;new.score:=0;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS community_thread_submission_guard ON public.community_threads;
CREATE TRIGGER community_thread_submission_guard
BEFORE INSERT ON public.community_threads FOR EACH ROW
EXECUTE FUNCTION public.enforce_community_thread_submission();
