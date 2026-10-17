
-- Close side channels from reporting/voting on hidden or banned community content.
DROP POLICY IF EXISTS community_votes_insert ON public.community_thread_votes;
CREATE POLICY community_votes_insert ON public.community_thread_votes FOR INSERT TO authenticated
WITH CHECK(user_id=auth.uid() AND EXISTS(
 SELECT 1 FROM public.community_threads t WHERE t.id=thread_id AND t.status='published'
 AND public.community_can_read(t.community_id,auth.uid())
 AND NOT EXISTS(SELECT 1 FROM public.discussion_bans b WHERE b.topic_id=t.community_id
 AND b.user_id=auth.uid())
));
DROP POLICY IF EXISTS community_votes_update ON public.community_thread_votes;
CREATE POLICY community_votes_update ON public.community_thread_votes FOR UPDATE TO authenticated
USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid() AND EXISTS(
 SELECT 1 FROM public.community_threads t WHERE t.id=thread_id AND t.status='published'
 AND public.community_can_read(t.community_id,auth.uid())
 AND NOT EXISTS(SELECT 1 FROM public.discussion_bans b WHERE b.topic_id=t.community_id
 AND b.user_id=auth.uid())
));
CREATE OR REPLACE FUNCTION public.check_community_report_target()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_target_community uuid;v_active boolean;
BEGIN
 IF auth.uid() IS NULL OR new.reporter_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Sign in to report community content' USING ERRCODE='42501';
 END IF;
 IF new.target_type='thread' THEN
  SELECT t.community_id,t.status='published' INTO v_target_community,v_active
  FROM public.community_threads t WHERE t.id=new.target_id;
 ELSE
  SELECT t.community_id,t.status='published' AND m.moderation_status='published'
  INTO v_target_community,v_active
  FROM public.discussion_messages m
  JOIN public.community_threads t ON t.id=m.thread_id WHERE m.id=new.target_id;
 END IF;
 IF v_target_community IS NULL OR v_target_community IS DISTINCT FROM new.community_id
 OR NOT v_active OR NOT public.community_can_read(v_target_community,auth.uid()) THEN
  RAISE EXCEPTION 'Reported content is not available to this account' USING ERRCODE='42501';
 END IF;
 IF (SELECT count(*) FROM public.community_reports r
 WHERE r.reporter_id=auth.uid() AND r.created_at>now()-interval '1 day')>=15 THEN
  RAISE EXCEPTION 'Daily report limit reached' USING ERRCODE='22023';
 END IF;
 new.status='pending';new.created_at=now();
 RETURN new;
END $$;
