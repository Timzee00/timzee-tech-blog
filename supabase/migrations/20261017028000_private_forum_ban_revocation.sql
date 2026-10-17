-- A banned member must not retain private community reading privileges.
CREATE OR REPLACE FUNCTION public.community_can_read(p_community uuid,p_actor uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_actor IS NOT DISTINCT FROM auth.uid() AND EXISTS(
 SELECT 1 FROM public.discussion_topics c WHERE c.id=p_community
 AND c.community_state<>'archived'
 AND (c.visibility='public'
 OR (p_actor IS NOT NULL AND
  NOT EXISTS(SELECT 1 FROM public.discussion_bans b
    WHERE b.topic_id=c.id AND b.user_id=p_actor)
  AND EXISTS(SELECT 1 FROM public.community_members m
    WHERE m.community_id=c.id AND m.user_id=p_actor))
 OR (public.community_is_moderator(c.id,p_actor)
  AND NOT EXISTS(SELECT 1 FROM public.discussion_bans b
   WHERE b.topic_id=c.id AND b.user_id=p_actor)))
 );
$$;
-- A ban on a private board also removes membership to prevent old signed-media access.
CREATE OR REPLACE FUNCTION public.community_ban_ends_membership()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF new.user_id IS NOT NULL AND new.topic_id IS NOT NULL
  AND EXISTS(SELECT 1 FROM public.discussion_topics c WHERE c.id=new.topic_id
   AND c.visibility<>'public') THEN
  DELETE FROM public.community_members WHERE community_id=new.topic_id AND user_id=new.user_id
    AND role<>'owner';
 END IF;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS community_ban_revokes_membership ON public.discussion_bans;
CREATE TRIGGER community_ban_revokes_membership
AFTER INSERT ON public.discussion_bans
FOR EACH ROW EXECUTE FUNCTION public.community_ban_ends_membership();
