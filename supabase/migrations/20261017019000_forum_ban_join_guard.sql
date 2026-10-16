-- A banned member may not immediately rejoin a community they cannot post in.
DROP POLICY IF EXISTS community_members_join ON public.community_members;
CREATE POLICY community_members_join ON public.community_members FOR INSERT TO authenticated
WITH CHECK(
 user_id=auth.uid() AND role='member'
 AND EXISTS(SELECT 1 FROM public.discussion_topics c
  WHERE c.id=community_id AND c.community_state='active')
 AND NOT EXISTS(SELECT 1 FROM public.discussion_bans b
  WHERE b.topic_id=community_id AND b.user_id=auth.uid())
);
