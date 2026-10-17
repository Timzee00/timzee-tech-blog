
-- Server-side, explainable anti-spam + quarantine, with moderator review.
-- No outside AI provider receives user content in this phase.
ALTER TABLE public.community_threads DROP CONSTRAINT IF EXISTS community_threads_status_check;
ALTER TABLE public.community_threads ADD CONSTRAINT community_threads_status_check
 CHECK(status IN ('published','pending','removed'));
ALTER TABLE public.discussion_messages ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'published'
 CHECK(moderation_status IN ('published','pending','removed'));
ALTER TABLE public.discussion_messages ADD COLUMN IF NOT EXISTS moderation_reason text;
ALTER TABLE public.community_threads ADD COLUMN IF NOT EXISTS moderation_reason text;
CREATE INDEX IF NOT EXISTS community_replies_moderation ON public.discussion_messages(thread_id,moderation_status,created_at DESC);

-- A pending submission remains visible to its author and community moderators.
DROP POLICY IF EXISTS community_threads_insert ON public.community_threads;
CREATE POLICY community_threads_insert ON public.community_threads FOR INSERT TO authenticated
WITH CHECK(author_id=auth.uid() AND status IN ('published','pending')
 AND NOT is_pinned AND NOT is_locked AND NOT is_legacy_room
 AND EXISTS(SELECT 1 FROM public.discussion_topics c WHERE c.id=community_id AND c.community_state='active'
 AND (c.posting_policy='everyone' OR
 (c.posting_policy='members' AND EXISTS(
 SELECT 1 FROM public.community_members m WHERE m.community_id=c.id AND m.user_id=auth.uid())) OR
 (c.posting_policy='staff' AND EXISTS(
 SELECT 1 FROM public.community_members m WHERE m.community_id=c.id AND m.user_id=auth.uid()
 AND m.role IN ('owner','moderator'))))
 AND NOT EXISTS(SELECT 1 FROM public.discussion_bans b WHERE b.topic_id=c.id AND b.user_id=auth.uid())));
DROP POLICY IF EXISTS "Community replies respect thread moderation" ON public.discussion_messages;
CREATE POLICY "Community replies respect thread moderation"
ON public.discussion_messages FOR SELECT TO anon,authenticated
USING(
 EXISTS(SELECT 1 FROM public.community_threads t WHERE t.id=thread_id
  AND public.community_can_read(t.community_id,auth.uid())
  AND (t.status='published' OR t.author_id=auth.uid()
    OR public.community_is_moderator(t.community_id,auth.uid()))
  AND (moderation_status='published' OR author_id=auth.uid()
    OR public.community_is_moderator(t.community_id,auth.uid())))
);

CREATE OR REPLACE FUNCTION public.forum_automod_reason(p_body text,p_rules text[],p_actor uuid,p_table text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_links integer;v_word text;v_duplicate boolean;
BEGIN
 IF length(coalesce(p_body,''))>8000 THEN RETURN 'Long post needs a review'; END IF;
 SELECT count(*) INTO v_links FROM regexp_matches(coalesce(p_body,''),'https?://','gi');
 IF v_links>=3 THEN RETURN 'Multiple external links'; END IF;
 FOREACH v_word IN ARRAY coalesce(p_rules,ARRAY[]::text[]) LOOP
  IF length(btrim(v_word))>=3
   AND position(lower(btrim(v_word)) IN lower(coalesce(p_body,'')))>0 THEN
    RETURN 'Community prohibited phrase';
  END IF;
 END LOOP;
 IF p_table='thread' THEN
  SELECT EXISTS(SELECT 1 FROM public.community_threads t
    WHERE t.author_id=p_actor AND t.created_at>now()-interval '15 minutes'
    AND lower(btrim(t.body))=lower(btrim(coalesce(p_body,''))) AND length(btrim(t.body))>25)
  INTO v_duplicate;
 ELSE
  SELECT EXISTS(SELECT 1 FROM public.discussion_messages m
    WHERE m.author_id=p_actor AND m.created_at>now()-interval '10 minutes'
    AND lower(btrim(m.body))=lower(btrim(coalesce(p_body,''))) AND length(btrim(m.body))>25)
  INTO v_duplicate;
 END IF;
 IF v_duplicate THEN RETURN 'Repeated identical content'; END IF;
 RETURN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.community_automod_thread()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_words text[];v_reason text;
BEGIN
 SELECT c.banned_words INTO v_words FROM public.discussion_topics c WHERE c.id=new.community_id;
 v_reason:=public.forum_automod_reason(new.title||' '||new.body,v_words,auth.uid(),'thread');
 IF v_reason IS NOT NULL THEN new.status='pending';new.moderation_reason=v_reason; END IF;
 RETURN new;
END $$;
CREATE TRIGGER forum_auto_moderate_thread BEFORE INSERT ON public.community_threads
FOR EACH ROW EXECUTE FUNCTION public.community_automod_thread();

CREATE OR REPLACE FUNCTION public.community_automod_reply()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_words text[];v_reason text;
BEGIN
 SELECT c.banned_words INTO v_words FROM public.discussion_topics c WHERE c.id=new.topic_id;
 v_reason:=public.forum_automod_reason(new.body,v_words,auth.uid(),'reply');
 IF v_reason IS NOT NULL THEN new.moderation_status='pending';new.moderation_reason=v_reason; END IF;
 RETURN new;
END $$;
CREATE TRIGGER forum_auto_moderate_reply BEFORE INSERT ON public.discussion_messages
FOR EACH ROW EXECUTE FUNCTION public.community_automod_reply();

CREATE OR REPLACE FUNCTION public.community_review_content(
 p_type text,p_id uuid,p_action text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_community uuid;
BEGIN
 IF p_type='thread' THEN
  SELECT community_id INTO v_community FROM public.community_threads WHERE id=p_id;
 ELSIF p_type='reply' THEN
  SELECT t.community_id INTO v_community FROM public.discussion_messages m
  JOIN public.community_threads t ON t.id=m.thread_id WHERE m.id=p_id;
 ELSE RAISE EXCEPTION 'Invalid content type' USING ERRCODE='22023'; END IF;
 IF v_community IS NULL OR NOT public.community_is_moderator(v_community,auth.uid()) THEN
  RAISE EXCEPTION 'Only moderators can review content' USING ERRCODE='42501';
 END IF;
 IF p_action NOT IN ('approve','remove') THEN
  RAISE EXCEPTION 'Invalid moderation action' USING ERRCODE='22023';
 END IF;
 IF p_type='thread' THEN
  UPDATE public.community_threads SET status=
   CASE WHEN p_action='approve' THEN 'published' ELSE 'removed' END,
   moderation_reason=NULL,updated_at=now() WHERE id=p_id;
 ELSE
  UPDATE public.discussion_messages SET moderation_status=
   CASE WHEN p_action='approve' THEN 'published' ELSE 'removed' END,
   moderation_reason=NULL WHERE id=p_id;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.community_review_content(text,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.community_review_content(text,uuid,text) TO authenticated;

-- Expose only a moderator's own community queue, never other communities.
CREATE OR REPLACE FUNCTION public.community_pending_content(p_community uuid,p_limit integer DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_items jsonb;
BEGIN
 IF NOT public.community_is_moderator(p_community,auth.uid()) THEN
  RAISE EXCEPTION 'Moderator access required' USING ERRCODE='42501';
 END IF;
 IF p_limit NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'Limit is 1–50' USING ERRCODE='22023'; END IF;
 SELECT coalesce(jsonb_agg(x.entry ORDER BY x.created_at DESC),'[]'::jsonb) INTO v_items FROM(
 SELECT t.created_at,jsonb_build_object('type','thread','id',t.id,'text',left(t.title||' '||t.body,400),
 'reason',t.moderation_reason,'created_at',t.created_at) entry
 FROM public.community_threads t WHERE t.community_id=p_community AND t.status='pending'
 UNION ALL
 SELECT m.created_at,jsonb_build_object('type','reply','id',m.id,'text',left(m.body,400),
 'reason',m.moderation_reason,'created_at',m.created_at)
 FROM public.discussion_messages m
 JOIN public.community_threads t ON t.id=m.thread_id
 WHERE t.community_id=p_community AND m.moderation_status='pending'
 ORDER BY created_at DESC LIMIT p_limit
 ) x;
 RETURN v_items;
END $$;
REVOKE ALL ON FUNCTION public.community_pending_content(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.community_pending_content(uuid,integer) TO authenticated;

-- High-risk: enforce reply visibility in raw API, and let creator see own pending content.
CREATE INDEX IF NOT EXISTS forum_pending_threads_queue ON public.community_threads(community_id,created_at DESC) WHERE status='pending';
CREATE INDEX IF NOT EXISTS forum_pending_replies_queue ON public.discussion_messages(topic_id,created_at DESC) WHERE moderation_status='pending';
