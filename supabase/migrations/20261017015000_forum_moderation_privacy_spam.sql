
-- Ensure removal/locking is enforced for raw API reads, not merely UI hiding.
DROP POLICY IF EXISTS "Discussion messages are public" ON public.discussion_messages;
DROP POLICY IF EXISTS "Community replies respect thread moderation" ON public.discussion_messages;
CREATE POLICY "Community replies respect thread moderation"
ON public.discussion_messages FOR SELECT TO anon,authenticated
USING (
 thread_id IS NULL OR EXISTS(
 SELECT 1 FROM public.community_threads t WHERE t.id=thread_id AND
 (t.status='published' OR t.author_id=auth.uid() OR
 EXISTS(SELECT 1 FROM public.community_members cm WHERE cm.community_id=t.community_id
  AND cm.user_id=auth.uid() AND cm.role IN ('owner','moderator'))
 OR coalesce(public.has_role_secure('super'),false)
 OR coalesce(public.has_role_secure('admin'),false)))
);

CREATE INDEX IF NOT EXISTS community_replies_author_recent_idx
 ON public.discussion_messages(author_id,created_at DESC);

CREATE OR REPLACE FUNCTION public.community_author_display_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_name text;
BEGIN
 IF auth.uid() IS NULL OR new.author_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Authenticated authorship required' USING ERRCODE='42501';
 END IF;
 SELECT NULLIF(btrim(p.display_name),'') INTO v_name FROM public.profiles p WHERE p.id=auth.uid();
 new.author_name=left(coalesce(v_name,'Member'),100);
 RETURN new;
END $$;

DROP TRIGGER IF EXISTS forum_thread_author_guard ON public.community_threads;
CREATE TRIGGER forum_thread_author_guard BEFORE INSERT ON public.community_threads
FOR EACH ROW EXECUTE FUNCTION public.community_author_display_guard();
DROP TRIGGER IF EXISTS forum_reply_author_guard ON public.discussion_messages;
CREATE TRIGGER forum_reply_author_guard BEFORE INSERT ON public.discussion_messages
FOR EACH ROW EXECUTE FUNCTION public.community_author_display_guard();
DROP TRIGGER IF EXISTS forum_board_author_guard ON public.discussion_topics;
CREATE TRIGGER forum_board_author_guard BEFORE INSERT ON public.discussion_topics
FOR EACH ROW EXECUTE FUNCTION public.community_author_display_guard();

-- Reject cross-user public media references in new replies; legacy clients
-- posting to their original topic ID remain compatible.
CREATE OR REPLACE FUNCTION public.forum_reply_media_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_prefix text;v_old_room boolean;
BEGIN
 IF new.media_url IS NULL THEN RETURN new; END IF;
 SELECT EXISTS(
  SELECT 1 FROM public.community_legacy_redirects map
   WHERE map.old_topic_id=new.topic_id AND map.thread_id=new.thread_id
 ) INTO v_old_room;
 IF v_old_room THEN RETURN new; END IF;
 v_prefix='https://duvbcwwprkzzyzikmcol.supabase.co/storage/v1/object/public/media/community-replies/'
  || auth.uid()::text || '/';
 IF new.media_url NOT LIKE v_prefix||'%' OR new.media_url LIKE '%..%'
   OR new.media_url ~ '[?#]' OR length(new.media_url)>1400 THEN
   RAISE EXCEPTION 'Use media uploaded to your own community reply folder'
    USING ERRCODE='42501';
 END IF;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS forum_reply_media_guard ON public.discussion_messages;
CREATE TRIGGER forum_reply_media_guard BEFORE INSERT ON public.discussion_messages
FOR EACH ROW EXECUTE FUNCTION public.forum_reply_media_guard();

-- Don't allow unlimited high-frequency replies from normal accounts.
CREATE OR REPLACE FUNCTION public.community_reply_rate_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_count integer;v_moderator boolean:=false;
BEGIN
 SELECT EXISTS(
  SELECT 1 FROM public.community_members m
  WHERE m.community_id=new.topic_id AND m.user_id=auth.uid()
   AND m.role IN ('owner','moderator')
 ) INTO v_moderator;
 IF v_moderator OR coalesce(public.has_role_secure('super'),false) THEN RETURN new; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text,93152));
 SELECT count(*) INTO v_count FROM public.discussion_messages m
 WHERE m.author_id=auth.uid() AND m.created_at>now()-interval '1 minute';
 IF v_count>=12 THEN
  RAISE EXCEPTION 'Posting too quickly. Please try again in a minute.' USING ERRCODE='22023';
 END IF;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS forum_reply_rate_guard ON public.discussion_messages;
CREATE TRIGGER forum_reply_rate_guard BEFORE INSERT ON public.discussion_messages
FOR EACH ROW EXECUTE FUNCTION public.community_reply_rate_guard();
