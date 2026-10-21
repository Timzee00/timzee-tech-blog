
CREATE TABLE IF NOT EXISTS public.community_reports(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 community_id uuid NOT NULL REFERENCES public.discussion_topics(id) ON DELETE CASCADE,
 reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 target_type text NOT NULL CHECK(target_type IN ('thread','reply')),
 target_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 10 AND 500),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','reviewed','dismissed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 resolved_at timestamptz,
 resolved_by uuid REFERENCES auth.users(id),
 UNIQUE(reporter_id,target_type,target_id)
);
CREATE INDEX IF NOT EXISTS community_reports_queue_idx
 ON public.community_reports(community_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS community_reports_user_idx
 ON public.community_reports(reporter_id,created_at DESC);
ALTER TABLE public.community_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_reports FROM anon,authenticated;
GRANT SELECT,INSERT ON public.community_reports TO authenticated;
CREATE POLICY community_reports_insert ON public.community_reports FOR INSERT TO authenticated
 WITH CHECK(reporter_id=auth.uid() AND status='pending');
CREATE POLICY community_reports_read ON public.community_reports FOR SELECT TO authenticated
 USING(reporter_id=auth.uid() OR
 EXISTS(SELECT 1 FROM public.community_members cm WHERE cm.community_id=community_reports.community_id
 AND cm.user_id=auth.uid() AND cm.role IN ('owner','moderator'))
 OR coalesce(public.has_role_secure('super'),false) OR coalesce(public.has_role_secure('admin'),false));
CREATE OR REPLACE FUNCTION public.check_community_report_target()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_target_community uuid;v_active boolean;
BEGIN
 IF auth.uid() IS NULL OR new.reporter_id IS DISTINCT FROM auth.uid() THEN
   RAISE EXCEPTION 'You must sign in to report content' USING ERRCODE='42501';
 END IF;
 IF new.target_type='thread' THEN
 SELECT t.community_id,t.status='published' INTO v_target_community,v_active
 FROM public.community_threads t WHERE t.id=new.target_id;
 ELSE
 SELECT t.community_id,t.status='published' INTO v_target_community,v_active
 FROM public.discussion_messages m
 JOIN public.community_threads t ON t.id=m.thread_id WHERE m.id=new.target_id;
 END IF;
 IF v_target_community IS NULL OR v_target_community IS DISTINCT FROM new.community_id OR NOT v_active THEN
  RAISE EXCEPTION 'Reported content is not visible in this community' USING ERRCODE='42501';
 END IF;
 IF (SELECT count(*) FROM public.community_reports r
     WHERE r.reporter_id=auth.uid() AND r.created_at>now()-interval '1 day')>=15 THEN
  RAISE EXCEPTION 'Daily report limit reached' USING ERRCODE='22023';
 END IF;
 new.status='pending';new.created_at=now();
 RETURN new;
END $$;
CREATE TRIGGER community_report_target_guard BEFORE INSERT ON public.community_reports
FOR EACH ROW EXECUTE FUNCTION public.check_community_report_target();

CREATE OR REPLACE FUNCTION public.community_review_report(p_report uuid,p_resolution text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_board uuid;
BEGIN
 IF p_resolution NOT IN ('reviewed','dismissed') THEN
   RAISE EXCEPTION 'Invalid resolution' USING ERRCODE='22023';
 END IF;
 SELECT community_id INTO v_board FROM public.community_reports WHERE id=p_report;
 IF v_board IS NULL THEN RAISE EXCEPTION 'Report unavailable' USING ERRCODE='22023'; END IF;
 IF NOT(coalesce(public.has_role_secure('super'),false) OR
  coalesce(public.has_role_secure('admin'),false) OR
  EXISTS(SELECT 1 FROM public.community_members m WHERE m.community_id=v_board
   AND m.user_id=auth.uid() AND m.role IN ('owner','moderator'))) THEN
   RAISE EXCEPTION 'Moderator permission required' USING ERRCODE='42501';
 END IF;
 UPDATE public.community_reports SET status=p_resolution,resolved_at=now(),
  resolved_by=auth.uid() WHERE id=p_report;
END $$;
REVOKE ALL ON FUNCTION public.community_review_report(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.community_review_report(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_moderate_member(
 p_community uuid,p_member uuid,p_action text,p_reason text DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor uuid:=auth.uid();v_role text;v_target_role text;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Sign in first' USING ERRCODE='42501'; END IF;
 SELECT m.role INTO v_role FROM public.community_members m
 WHERE m.community_id=p_community AND m.user_id=v_actor;
 SELECT m.role INTO v_target_role FROM public.community_members m
 WHERE m.community_id=p_community AND m.user_id=p_member;
 IF NOT(coalesce(public.has_role_secure('super'),false) OR
 coalesce(public.has_role_secure('admin'),false) OR v_role IN ('owner','moderator')) THEN
 RAISE EXCEPTION 'Moderator permission required' USING ERRCODE='42501';
 END IF;
 IF p_member=v_actor OR v_target_role='owner'
   OR (v_role='moderator' AND v_target_role='moderator') THEN
  RAISE EXCEPTION 'Cannot moderate this account' USING ERRCODE='42501';
 END IF;
 IF p_action='ban' THEN
  IF NOT EXISTS(SELECT 1 FROM public.discussion_bans b
    WHERE b.topic_id=p_community AND b.user_id=p_member) THEN
   INSERT INTO public.discussion_bans(id,topic_id,user_id,user_name,banned_by,reason,created_at)
   VALUES(gen_random_uuid(),p_community,p_member,'Member',v_actor,
    left(coalesce(nullif(btrim(p_reason),''),'Community rule violation'),500),now());
  END IF;
 ELSIF p_action='unban' THEN
   DELETE FROM public.discussion_bans WHERE topic_id=p_community AND user_id=p_member;
 ELSE RAISE EXCEPTION 'Invalid moderation action' USING ERRCODE='22023';
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.community_moderate_member(uuid,uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.community_moderate_member(uuid,uuid,text,text) TO authenticated;
