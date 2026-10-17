
-- Private / restricted communities. Server-enforced: raw PostgREST reads are scoped.
ALTER TABLE public.discussion_topics ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public';
ALTER TABLE public.discussion_topics DROP CONSTRAINT IF EXISTS forum_visibility_allowed;
ALTER TABLE public.discussion_topics ADD CONSTRAINT forum_visibility_allowed
 CHECK(visibility IN ('public','restricted','private'));

CREATE TABLE IF NOT EXISTS public.community_join_requests(
 community_id uuid NOT NULL REFERENCES public.discussion_topics(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
 note text NOT NULL DEFAULT '' CHECK(length(note)<=400),
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_at timestamptz,
 reviewed_by uuid REFERENCES auth.users(id),
 PRIMARY KEY(community_id,user_id)
);
CREATE INDEX IF NOT EXISTS community_join_requests_queue ON public.community_join_requests(community_id,status,created_at DESC);
ALTER TABLE public.community_join_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_join_requests FROM anon,authenticated;
GRANT SELECT,INSERT ON public.community_join_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.community_is_moderator(p_community uuid,p_actor uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
 SELECT p_actor IS NOT NULL AND (
  EXISTS(SELECT 1 FROM public.community_members m WHERE m.community_id=p_community
     AND m.user_id=p_actor AND m.role IN ('owner','moderator'))
  OR (p_actor=auth.uid() AND
      (coalesce(public.has_role_secure('super'),false)
       OR coalesce(public.has_role_secure('admin'),false)))
 );
$$;
REVOKE ALL ON FUNCTION public.community_is_moderator(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_is_moderator(uuid,uuid) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.community_can_read(p_community uuid,p_actor uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.discussion_topics b WHERE b.id=p_community
 AND b.community_state<>'archived' AND
 (b.visibility='public'
 OR (p_actor IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.community_members m
  WHERE m.community_id=b.id AND m.user_id=p_actor))
 OR public.community_is_moderator(b.id,p_actor)));
$$;
REVOKE ALL ON FUNCTION public.community_can_read(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_can_read(uuid,uuid) TO anon,authenticated;

-- All public boards' metadata remains discoverable. Restricted boards can be
-- discovered and requested, but thread/reply contents are member-only.
DROP POLICY IF EXISTS "Discussion topics are public" ON public.discussion_topics;
CREATE POLICY "Visible community directory" ON public.discussion_topics FOR SELECT TO anon,authenticated
USING(community_state<>'archived' AND (
 visibility IN ('public','restricted') OR public.community_can_read(id,auth.uid())
) OR EXISTS(SELECT 1 FROM public.community_legacy_redirects r WHERE r.old_topic_id=id
  AND public.community_can_read(r.community_id,auth.uid()))
);
DROP POLICY IF EXISTS community_threads_read ON public.community_threads;
CREATE POLICY community_threads_read ON public.community_threads FOR SELECT TO anon,authenticated
USING(public.community_can_read(community_id,auth.uid()) AND
 (status='published' OR author_id=auth.uid()
  OR public.community_is_moderator(community_id,auth.uid())));
DROP POLICY IF EXISTS "Community replies respect thread moderation" ON public.discussion_messages;
CREATE POLICY "Community replies respect thread moderation" ON public.discussion_messages FOR SELECT TO anon,authenticated
USING(EXISTS(SELECT 1 FROM public.community_threads t WHERE t.id=thread_id
  AND public.community_can_read(t.community_id,auth.uid())
  AND (t.status='published' OR t.author_id=auth.uid()
   OR public.community_is_moderator(t.community_id,auth.uid()))));
DROP POLICY IF EXISTS community_members_read ON public.community_members;
CREATE POLICY community_members_read ON public.community_members FOR SELECT TO authenticated
USING(user_id=auth.uid() OR public.community_is_moderator(community_id,auth.uid()));
DROP POLICY IF EXISTS community_members_join ON public.community_members;
CREATE POLICY community_members_join ON public.community_members FOR INSERT TO authenticated
WITH CHECK(user_id=auth.uid() AND role='member' AND
 EXISTS(SELECT 1 FROM public.discussion_topics c
 WHERE c.id=community_id AND c.community_state='active' AND c.visibility='public')
 AND NOT EXISTS(SELECT 1 FROM public.discussion_bans b
 WHERE b.topic_id=community_id AND b.user_id=auth.uid()));

DROP POLICY IF EXISTS "Requested membership visible to applicant or moderators" ON public.community_join_requests;
CREATE POLICY "Requested membership visible to applicant or moderators"
ON public.community_join_requests FOR SELECT TO authenticated
USING(user_id=auth.uid() OR public.community_is_moderator(community_id,auth.uid()));
DROP POLICY IF EXISTS "Submit membership request" ON public.community_join_requests;
CREATE POLICY "Submit membership request" ON public.community_join_requests FOR INSERT TO authenticated
WITH CHECK(user_id=auth.uid() AND status='pending' AND reviewed_by IS NULL
 AND EXISTS(SELECT 1 FROM public.discussion_topics c WHERE c.id=community_id AND
 c.visibility IN ('restricted','private') AND c.community_state='active')
 AND NOT EXISTS(SELECT 1 FROM public.discussion_bans b
 WHERE b.topic_id=community_id AND b.user_id=auth.uid()));

CREATE OR REPLACE FUNCTION public.community_review_join(p_community uuid,p_member uuid,p_approve boolean)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor uuid:=auth.uid();
BEGIN
 IF NOT public.community_is_moderator(p_community,v_actor) THEN
  RAISE EXCEPTION 'Moderator permission required' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.community_join_requests r
 WHERE r.community_id=p_community AND r.user_id=p_member AND r.status='pending') THEN
  RAISE EXCEPTION 'No pending join request' USING ERRCODE='22023';
 END IF;
 IF p_approve AND EXISTS(SELECT 1 FROM public.discussion_bans b
 WHERE b.topic_id=p_community AND b.user_id=p_member) THEN
  RAISE EXCEPTION 'Banned member cannot be approved' USING ERRCODE='42501';
 END IF;
 UPDATE public.community_join_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'rejected' END,
 reviewed_at=now(),reviewed_by=v_actor WHERE community_id=p_community AND user_id=p_member;
 IF p_approve THEN
 INSERT INTO public.community_members(community_id,user_id,role)
 VALUES(p_community,p_member,'member') ON CONFLICT DO NOTHING;
 END IF;
END $$;
REVOKE ALL ON FUNCTION public.community_review_join(uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.community_review_join(uuid,uuid,boolean) TO authenticated;

-- Community visibility is enforced at insert time even for old clients.
CREATE OR REPLACE FUNCTION public.community_private_posting_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_visibility text;
BEGIN
 SELECT c.visibility INTO v_visibility FROM public.discussion_topics c WHERE c.id=new.community_id;
 IF v_visibility IN ('private','restricted') AND NOT public.community_can_read(new.community_id,auth.uid()) THEN
  RAISE EXCEPTION 'Join this community before posting' USING ERRCODE='42501';
 END IF;
 RETURN new;
END $$;
CREATE TRIGGER community_private_thread_guard BEFORE INSERT ON public.community_threads
FOR EACH ROW EXECUTE FUNCTION public.community_private_posting_guard();

-- Prevent owner changes to counters/ownership through the generic UPDATE API.
CREATE OR REPLACE FUNCTION public.community_board_protected_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_user<>'postgres' AND (
  new.author_id IS DISTINCT FROM old.author_id
  OR new.member_count IS DISTINCT FROM old.member_count
  OR new.community_state IS DISTINCT FROM old.community_state
  OR new.slug IS DISTINCT FROM old.slug
 ) THEN
  RAISE EXCEPTION 'Protected community fields cannot be changed' USING ERRCODE='42501';
 END IF;
 RETURN new;
END $$;
CREATE TRIGGER community_board_protected_update BEFORE UPDATE ON public.discussion_topics
FOR EACH ROW EXECUTE FUNCTION public.community_board_protected_fields();
