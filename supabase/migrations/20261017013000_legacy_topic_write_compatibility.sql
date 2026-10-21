CREATE OR REPLACE FUNCTION public.community_reply_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE thread public.community_threads%ROWTYPE;board public.discussion_topics%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR new.author_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Sign in to participate' USING ERRCODE='42501';
 END IF;
 IF new.thread_id IS NULL AND new.topic_id IS NOT NULL THEN
  SELECT id INTO new.thread_id FROM public.community_threads
  WHERE community_id=new.topic_id AND is_legacy_room LIMIT 1;
  -- Legacy clients may still post into an old topic ID after reclassification.
  IF new.thread_id IS NULL THEN
   SELECT map.thread_id INTO new.thread_id FROM public.community_legacy_redirects map
   WHERE map.old_topic_id=new.topic_id;
  END IF;
 END IF;
 SELECT * INTO thread FROM public.community_threads WHERE id=new.thread_id;
 IF NOT FOUND OR thread.status<>'published' OR thread.is_locked THEN
  RAISE EXCEPTION 'Thread unavailable or locked' USING ERRCODE='42501';
 END IF;
 IF new.topic_id IS DISTINCT FROM thread.community_id AND NOT EXISTS(
  SELECT 1 FROM public.community_legacy_redirects map
  WHERE map.old_topic_id=new.topic_id AND map.thread_id=new.thread_id
 ) THEN
  RAISE EXCEPTION 'Reply belongs to another community' USING ERRCODE='42501';
 END IF;
 SELECT * INTO board FROM public.discussion_topics WHERE id=thread.community_id;
 IF board.community_state<>'active' THEN
  RAISE EXCEPTION 'Community is read-only' USING ERRCODE='42501';
 END IF;
 IF board.posting_policy='members' AND NOT EXISTS(SELECT 1 FROM public.community_members cm
 WHERE cm.community_id=thread.community_id AND cm.user_id=auth.uid()) THEN
  RAISE EXCEPTION 'Join the community to post' USING ERRCODE='42501';
 END IF;
 IF board.posting_policy='staff' AND NOT EXISTS(SELECT 1 FROM public.community_members cm
 WHERE cm.community_id=thread.community_id AND cm.user_id=auth.uid() AND cm.role IN ('owner','moderator')) THEN
  RAISE EXCEPTION 'Staff-only discussion' USING ERRCODE='42501';
 END IF;
 IF EXISTS(SELECT 1 FROM public.discussion_bans b WHERE b.topic_id=thread.community_id
 AND b.user_id=auth.uid()) THEN
  RAISE EXCEPTION 'Banned from this community' USING ERRCODE='42501';
 END IF;
 IF new.reply_to IS NOT NULL AND NOT EXISTS(SELECT 1 FROM public.discussion_messages old
 WHERE old.id=new.reply_to AND old.thread_id=new.thread_id) THEN
  RAISE EXCEPTION 'Reply reference is from another thread' USING ERRCODE='22023';
 END IF;
 IF length(btrim(coalesce(new.body,'')))<1 AND new.media_url IS NULL THEN
  RAISE EXCEPTION 'Write a reply' USING ERRCODE='22023';
 END IF;
 IF length(coalesce(new.body,''))>10000 THEN
  RAISE EXCEPTION 'Reply is too long' USING ERRCODE='22023';
 END IF;
 new.created_at:=now();
 RETURN new;
END $function$
;
