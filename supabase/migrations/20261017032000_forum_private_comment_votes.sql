
-- Comment voting must not expose users' private vote records.
DROP POLICY IF EXISTS "Anyone can read vote scores" ON public.discussion_message_votes;
CREATE POLICY forum_reply_votes_own_read ON public.discussion_message_votes FOR SELECT TO authenticated
USING(user_id=auth.uid());
DROP POLICY IF EXISTS "Users can cast their own vote" ON public.discussion_message_votes;
CREATE POLICY forum_reply_votes_safe_insert ON public.discussion_message_votes FOR INSERT TO authenticated
WITH CHECK(user_id=auth.uid() AND EXISTS(
 SELECT 1 FROM public.discussion_messages m
 JOIN public.community_threads t ON t.id=m.thread_id
 WHERE m.id=message_id AND m.moderation_status='published' AND t.status='published'
 AND public.community_can_read(t.community_id,auth.uid())
 AND NOT EXISTS(SELECT 1 FROM public.discussion_bans b
 WHERE b.topic_id=t.community_id AND b.user_id=auth.uid())
));
DROP POLICY IF EXISTS "Users can change their own vote" ON public.discussion_message_votes;
CREATE POLICY forum_reply_votes_safe_update ON public.discussion_message_votes FOR UPDATE TO authenticated
USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
-- Existing user-only delete policy remains valid.

CREATE OR REPLACE FUNCTION public.forum_reply_vote_summary(p_messages uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_results jsonb;
BEGIN
 IF p_messages IS NULL OR coalesce(array_length(p_messages,1),0)>40 THEN
  RAISE EXCEPTION 'Request up to forty reply IDs' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'message_id',m.id,'score',coalesce(v.score,0),'my_vote',v.mine)),'[]'::jsonb)
 INTO v_results FROM public.discussion_messages m
 JOIN public.community_threads t ON t.id=m.thread_id
 LEFT JOIN LATERAL(
  SELECT coalesce(sum(x.value),0)::integer AS score,
   max(x.value) FILTER(WHERE x.user_id=auth.uid()) AS mine
  FROM public.discussion_message_votes x WHERE x.message_id=m.id
 ) v ON TRUE
 WHERE m.id=ANY(p_messages) AND m.moderation_status='published'
 AND t.status='published' AND public.community_can_read(t.community_id,auth.uid());
 RETURN v_results;
END $$;
REVOKE ALL ON FUNCTION public.forum_reply_vote_summary(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.forum_reply_vote_summary(uuid[]) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.forum_cast_reply_vote(p_message uuid,p_value smallint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_board uuid;v_old smallint;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to vote' USING ERRCODE='42501'; END IF;
 IF p_value NOT IN (-1,1) THEN RAISE EXCEPTION 'Only +1 or -1 accepted' USING ERRCODE='22023'; END IF;
 SELECT t.community_id INTO v_board FROM public.discussion_messages m
 JOIN public.community_threads t ON t.id=m.thread_id
 WHERE m.id=p_message AND m.moderation_status='published' AND t.status='published';
 IF v_board IS NULL OR NOT public.community_can_read(v_board,auth.uid()) OR
 EXISTS(SELECT 1 FROM public.discussion_bans b WHERE b.topic_id=v_board AND b.user_id=auth.uid()) THEN
  RAISE EXCEPTION 'This reply is unavailable for voting' USING ERRCODE='42501';
 END IF;
 SELECT value INTO v_old FROM public.discussion_message_votes
 WHERE message_id=p_message AND user_id=auth.uid();
 IF v_old=p_value THEN
  DELETE FROM public.discussion_message_votes WHERE message_id=p_message AND user_id=auth.uid();
 ELSIF v_old IS NULL THEN
  INSERT INTO public.discussion_message_votes(message_id,user_id,value)
  VALUES(p_message,auth.uid(),p_value);
 ELSE
  UPDATE public.discussion_message_votes SET value=p_value
  WHERE message_id=p_message AND user_id=auth.uid();
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.forum_cast_reply_vote(uuid,smallint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.forum_cast_reply_vote(uuid,smallint) TO authenticated;
