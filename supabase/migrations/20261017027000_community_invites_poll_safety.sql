
-- Private board join requests cannot depend on being able to SELECT an unlisted board.
CREATE OR REPLACE FUNCTION public.community_request_join(p_community uuid,p_note text DEFAULT '')
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor uuid:=auth.uid();v_visibility text;v_pending boolean;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Sign in to request membership' USING ERRCODE='42501'; END IF;
 SELECT visibility INTO v_visibility FROM public.discussion_topics
 WHERE id=p_community AND community_state='active';
 IF v_visibility IS NULL THEN RAISE EXCEPTION 'Community unavailable' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.community_members m
 WHERE m.community_id=p_community AND m.user_id=v_actor) THEN RETURN 'joined'; END IF;
 IF EXISTS(SELECT 1 FROM public.discussion_bans b
 WHERE b.topic_id=p_community AND b.user_id=v_actor) THEN
  RAISE EXCEPTION 'Membership request unavailable' USING ERRCODE='42501';
 END IF;
 IF v_visibility='public' THEN
  RAISE EXCEPTION 'Public communities can be joined directly' USING ERRCODE='22023';
 END IF;
 IF length(coalesce(p_note,''))>400 THEN
  RAISE EXCEPTION 'Membership note must be under 400 characters' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.community_join_requests(community_id,user_id,status,note)
 VALUES(p_community,v_actor,'pending',coalesce(p_note,''))
 ON CONFLICT(community_id,user_id) DO UPDATE
 SET status='pending',note=excluded.note,created_at=now(),
 reviewed_at=NULL,reviewed_by=NULL
 WHERE public.community_join_requests.status='rejected'
 AND public.community_join_requests.reviewed_at<now()-interval '7 days';
 RETURN 'pending';
END $$;
REVOKE ALL ON FUNCTION public.community_request_join(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.community_request_join(uuid,text) TO authenticated;

-- Count only published replies in public counters.
CREATE OR REPLACE FUNCTION public.community_reply_counter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_delta integer:=0;v_target uuid;
BEGIN
 IF TG_OP='INSERT' THEN
  v_target:=new.thread_id;
  IF new.moderation_status='published' THEN v_delta:=1; END IF;
 ELSIF TG_OP='DELETE' THEN
  v_target:=old.thread_id;
  IF old.moderation_status='published' THEN v_delta:=-1; END IF;
 ELSE
  v_target:=new.thread_id;
  IF old.moderation_status IS DISTINCT FROM new.moderation_status THEN
   v_delta:=CASE WHEN new.moderation_status='published' THEN 1 ELSE -1 END;
  END IF;
 END IF;
 IF v_target IS NOT NULL AND v_delta<>0 THEN
  UPDATE public.community_threads SET
    reply_count=greatest(reply_count+v_delta,0),
    last_activity_at=CASE WHEN v_delta>0 THEN greatest(last_activity_at,now())
    ELSE last_activity_at END
  WHERE id=v_target;
 END IF;
 RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS community_reply_counter_trigger ON public.discussion_messages;
CREATE TRIGGER community_reply_counter_trigger
AFTER INSERT OR DELETE OR UPDATE OF moderation_status ON public.discussion_messages
FOR EACH ROW EXECUTE FUNCTION public.community_reply_counter();
UPDATE public.community_threads thread SET reply_count=(
 SELECT count(*)::integer FROM public.discussion_messages m WHERE m.thread_id=thread.id
 AND m.moderation_status='published');

-- Don't permit a banned member to vote in their old public board.
CREATE OR REPLACE FUNCTION public.community_vote_poll(p_poll uuid,p_option smallint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_poll public.community_polls%ROWTYPE;v_board uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to vote' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_poll FROM public.community_polls WHERE id=p_poll FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Poll not found' USING ERRCODE='22023'; END IF;
 SELECT community_id INTO v_board FROM public.community_threads
 WHERE id=v_poll.thread_id AND status='published';
 IF v_board IS NULL OR NOT public.community_can_read(v_board,auth.uid())
 OR EXISTS(SELECT 1 FROM public.discussion_bans b
 WHERE b.topic_id=v_board AND b.user_id=auth.uid()) THEN
  RAISE EXCEPTION 'Poll unavailable' USING ERRCODE='42501';
 END IF;
 IF v_poll.closed_at IS NOT NULL OR (v_poll.ends_at IS NOT NULL AND v_poll.ends_at<=now()) THEN
  RAISE EXCEPTION 'Voting is closed' USING ERRCODE='22023';
 END IF;
 IF p_option<1 OR p_option>array_length(v_poll.options,1) THEN
  RAISE EXCEPTION 'Invalid option' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.community_poll_votes(poll_id,user_id,option_number)
 VALUES(p_poll,auth.uid(),p_option)
 ON CONFLICT(poll_id,user_id) DO UPDATE SET
 option_number=excluded.option_number,created_at=now();
END $$;
