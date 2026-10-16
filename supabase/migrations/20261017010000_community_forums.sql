
-- Convert existing discussion_topics into durable boards, preserving IDs.
ALTER TABLE public.discussion_topics
 ADD COLUMN IF NOT EXISTS slug text,
 ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'Technology',
 ADD COLUMN IF NOT EXISTS posting_policy text NOT NULL DEFAULT 'everyone',
 ADD COLUMN IF NOT EXISTS community_state text NOT NULL DEFAULT 'active',
 ADD COLUMN IF NOT EXISTS member_count integer NOT NULL DEFAULT 0,
 ADD COLUMN IF NOT EXISTS rules text NOT NULL DEFAULT '',
 ADD COLUMN IF NOT EXISTS icon_emoji text NOT NULL DEFAULT '💬';
UPDATE public.discussion_topics SET slug=left(trim(both '-' FROM regexp_replace(lower(coalesce(title,'community')),'[^a-z0-9]+','-','g')),46)||'-'||left(replace(id::text,'-',''),8)
WHERE slug IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS community_slug_unique_idx ON public.discussion_topics(slug);
CREATE INDEX IF NOT EXISTS community_category_idx ON public.discussion_topics(category,created_at DESC);
ALTER TABLE public.discussion_topics ADD CONSTRAINT community_posting_policy_valid
 CHECK(posting_policy IN ('everyone','members','staff'));
ALTER TABLE public.discussion_topics ADD CONSTRAINT community_state_valid
 CHECK(community_state IN ('active','restricted','archived'));

CREATE OR REPLACE FUNCTION public.community_slug_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' AND (new.slug IS NULL OR btrim(new.slug)='') THEN
  new.slug:=left(trim(both '-' FROM regexp_replace(lower(coalesce(new.title,'community')),'[^a-z0-9]+','-','g')),46)||'-'||left(replace(new.id::text,'-',''),8);
 END IF;
 IF new.slug !~ '^[a-z0-9][a-z0-9-]{1,70}$' THEN RAISE EXCEPTION 'Invalid community slug'; END IF;
 IF TG_OP='UPDATE' AND new.slug IS DISTINCT FROM old.slug THEN
  RAISE EXCEPTION 'Community links cannot be renamed' USING ERRCODE='42501';
 END IF;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS community_slug_guard_trigger ON public.discussion_topics;
CREATE TRIGGER community_slug_guard_trigger BEFORE INSERT OR UPDATE OF slug,title ON public.discussion_topics
FOR EACH ROW EXECUTE FUNCTION public.community_slug_guard();

CREATE TABLE IF NOT EXISTS public.community_members(
 community_id uuid NOT NULL REFERENCES public.discussion_topics(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 role text NOT NULL DEFAULT 'member' CHECK(role IN ('owner','moderator','member')),
 joined_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(community_id,user_id)
);
CREATE INDEX IF NOT EXISTS community_members_user_idx ON public.community_members(user_id,joined_at DESC);
ALTER TABLE public.community_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_members FROM anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.community_members TO authenticated;
CREATE POLICY community_members_read ON public.community_members FOR SELECT TO authenticated USING(true);
CREATE POLICY community_members_join ON public.community_members FOR INSERT TO authenticated
 WITH CHECK(user_id=auth.uid() AND role='member' AND EXISTS(
 SELECT 1 FROM public.discussion_topics c WHERE c.id=community_id AND c.community_state='active'));
CREATE POLICY community_members_leave ON public.community_members FOR DELETE TO authenticated
 USING(user_id=auth.uid() AND role<>'owner');

CREATE OR REPLACE FUNCTION public.community_member_counter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' THEN
 UPDATE public.discussion_topics SET member_count=member_count+1 WHERE id=new.community_id;
 RETURN new;
 END IF;
 UPDATE public.discussion_topics SET member_count=greatest(0,member_count-1) WHERE id=old.community_id;
 RETURN old;
END $$;
CREATE TRIGGER community_member_counter_trigger AFTER INSERT OR DELETE ON public.community_members
FOR EACH ROW EXECUTE FUNCTION public.community_member_counter();

-- Legacy orphan IDs are not recreated as fake auth identities; retain text labels.
INSERT INTO public.community_members(community_id,user_id,role)
SELECT t.id,t.author_id,'owner' FROM public.discussion_topics t
JOIN auth.users au ON au.id=t.author_id
ON CONFLICT(community_id,user_id) DO UPDATE SET role='owner';
INSERT INTO public.community_members(community_id,user_id,role)
SELECT l.topic_id,l.user_id,'member' FROM public.discussion_topic_likes l
JOIN auth.users au ON au.id=l.user_id
JOIN public.discussion_topics t ON t.id=l.topic_id
WHERE t.author_id IS DISTINCT FROM l.user_id
ON CONFLICT DO NOTHING;
UPDATE public.discussion_topics t SET member_count=(
 SELECT count(*)::integer FROM public.community_members cm WHERE cm.community_id=t.id);

CREATE OR REPLACE FUNCTION public.community_owner_member()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF new.author_id IS NOT NULL AND EXISTS(SELECT 1 FROM auth.users u WHERE u.id=new.author_id) THEN
 INSERT INTO public.community_members(community_id,user_id,role)
 VALUES(new.id,new.author_id,'owner') ON CONFLICT DO NOTHING;
 END IF;
 RETURN new;
END $$;
CREATE TRIGGER community_owner_member_trigger AFTER INSERT ON public.discussion_topics
FOR EACH ROW EXECUTE FUNCTION public.community_owner_member();

CREATE TABLE IF NOT EXISTS public.community_threads(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 community_id uuid NOT NULL REFERENCES public.discussion_topics(id) ON DELETE CASCADE,
 author_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 author_name text NOT NULL DEFAULT 'Member',
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 5 AND 180),
 body text NOT NULL DEFAULT '' CHECK(length(body)<=12000),
 kind text NOT NULL DEFAULT 'discussion' CHECK(kind IN ('discussion','question','guide','news','showcase','announcement')),
 flair text CHECK(flair IS NULL OR length(flair)<=28),
 status text NOT NULL DEFAULT 'published' CHECK(status IN ('published','removed')),
 is_pinned boolean NOT NULL DEFAULT false,
 is_locked boolean NOT NULL DEFAULT false,
 is_legacy_room boolean NOT NULL DEFAULT false,
 reply_count integer NOT NULL DEFAULT 0,
 score integer NOT NULL DEFAULT 0,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 last_activity_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX community_threads_legacy_unique ON public.community_threads(community_id) WHERE is_legacy_room;
CREATE INDEX community_threads_new_idx ON public.community_threads(community_id,status,is_pinned DESC,created_at DESC,id DESC);
CREATE INDEX community_threads_active_idx ON public.community_threads(community_id,status,last_activity_at DESC,id DESC);
CREATE INDEX community_threads_top_idx ON public.community_threads(community_id,status,score DESC,created_at DESC,id DESC);
CREATE INDEX community_threads_global_new_idx ON public.community_threads(status,created_at DESC,id DESC);
CREATE INDEX community_threads_global_active_idx ON public.community_threads(status,last_activity_at DESC,id DESC);
CREATE INDEX community_threads_author_idx ON public.community_threads(author_id,created_at DESC);
ALTER TABLE public.community_threads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_threads FROM anon,authenticated;
GRANT SELECT ON public.community_threads TO anon,authenticated;
GRANT INSERT ON public.community_threads TO authenticated;
CREATE POLICY community_threads_read ON public.community_threads FOR SELECT TO anon,authenticated
 USING(status='published' OR author_id=auth.uid() OR EXISTS(
 SELECT 1 FROM public.discussion_topics c WHERE c.id=community_id AND c.author_id=auth.uid()));
CREATE POLICY community_threads_insert ON public.community_threads FOR INSERT TO authenticated
 WITH CHECK(author_id=auth.uid() AND status='published' AND NOT is_pinned
 AND NOT is_locked AND NOT is_legacy_room AND
 EXISTS(SELECT 1 FROM public.discussion_topics c WHERE c.id=community_id AND c.community_state='active'
 AND (c.posting_policy='everyone'
 OR(c.posting_policy='members' AND EXISTS(SELECT 1 FROM public.community_members m
 WHERE m.community_id=c.id AND m.user_id=auth.uid()))
 OR(c.posting_policy='staff' AND EXISTS(SELECT 1 FROM public.community_members m
 WHERE m.community_id=c.id AND m.user_id=auth.uid() AND m.role IN ('owner','moderator'))))
 AND NOT EXISTS(SELECT 1 FROM public.discussion_bans b WHERE b.topic_id=c.id AND b.user_id=auth.uid())));

INSERT INTO public.community_threads(
 community_id,author_id,author_name,title,body,kind,is_legacy_room,created_at,last_activity_at)
SELECT c.id,au.id,coalesce(c.author_name,'Member'),'Original community discussion',
 'Archive of the original community conversation. Earlier messages and replies are preserved.',
 'discussion',true,coalesce(c.created_at,now()),coalesce(c.updated_at,now())
FROM public.discussion_topics c LEFT JOIN auth.users au ON au.id=c.author_id;
ALTER TABLE public.discussion_messages ADD COLUMN IF NOT EXISTS thread_id uuid
 REFERENCES public.community_threads(id) ON DELETE SET NULL;
UPDATE public.discussion_messages m SET thread_id=t.id
FROM public.community_threads t WHERE t.community_id=m.topic_id AND t.is_legacy_room
AND m.thread_id IS NULL;
CREATE INDEX community_messages_thread_idx ON public.discussion_messages(thread_id,created_at,id);
UPDATE public.community_threads t SET reply_count=(
 SELECT count(*)::integer FROM public.discussion_messages m WHERE m.thread_id=t.id)
 WHERE t.is_legacy_room;

CREATE OR REPLACE FUNCTION public.community_reply_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE thread public.community_threads%ROWTYPE;board public.discussion_topics%ROWTYPE;
BEGIN
 IF auth.uid() IS NULL OR new.author_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Sign in to participate' USING ERRCODE='42501';
 END IF;
 IF new.thread_id IS NULL AND new.topic_id IS NOT NULL THEN
  SELECT id INTO new.thread_id FROM public.community_threads
  WHERE community_id=new.topic_id AND is_legacy_room LIMIT 1;
 END IF;
 SELECT * INTO thread FROM public.community_threads WHERE id=new.thread_id;
 IF NOT FOUND OR thread.status<>'published' OR thread.is_locked THEN
  RAISE EXCEPTION 'Thread unavailable or locked' USING ERRCODE='42501';
 END IF;
 IF new.topic_id IS DISTINCT FROM thread.community_id THEN
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
END $$;
CREATE TRIGGER community_reply_guard_trigger BEFORE INSERT ON public.discussion_messages
FOR EACH ROW EXECUTE FUNCTION public.community_reply_guard();

CREATE OR REPLACE FUNCTION public.community_reply_counter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' AND new.thread_id IS NOT NULL THEN
 UPDATE public.community_threads SET reply_count=reply_count+1,
 last_activity_at=greatest(last_activity_at,new.created_at) WHERE id=new.thread_id;
 END IF;
 IF TG_OP='DELETE' AND old.thread_id IS NOT NULL THEN
 UPDATE public.community_threads SET reply_count=greatest(0,reply_count-1) WHERE id=old.thread_id;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER community_reply_counter_trigger AFTER INSERT OR DELETE ON public.discussion_messages
FOR EACH ROW EXECUTE FUNCTION public.community_reply_counter();

CREATE TABLE public.community_thread_votes(
 thread_id uuid NOT NULL REFERENCES public.community_threads(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 value smallint NOT NULL CHECK(value IN (-1,1)),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(thread_id,user_id)
);
CREATE INDEX community_votes_user_idx ON public.community_thread_votes(user_id,created_at DESC);
ALTER TABLE public.community_thread_votes ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.community_thread_votes TO authenticated;
CREATE POLICY community_votes_read ON public.community_thread_votes FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY community_votes_insert ON public.community_thread_votes FOR INSERT TO authenticated
 WITH CHECK(user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.community_threads t WHERE t.id=thread_id AND t.status='published'));
CREATE POLICY community_votes_update ON public.community_thread_votes FOR UPDATE TO authenticated
 USING(user_id=auth.uid()) WITH CHECK(user_id=auth.uid());
CREATE POLICY community_votes_delete ON public.community_thread_votes FOR DELETE TO authenticated USING(user_id=auth.uid());
CREATE OR REPLACE FUNCTION public.community_vote_counter()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='INSERT' THEN UPDATE public.community_threads SET score=score+new.value WHERE id=new.thread_id;
 ELSIF TG_OP='DELETE' THEN UPDATE public.community_threads SET score=score-old.value WHERE id=old.thread_id;
 ELSIF TG_OP='UPDATE' THEN
  IF new.thread_id IS DISTINCT FROM old.thread_id THEN RAISE EXCEPTION 'Cannot transfer votes'; END IF;
  UPDATE public.community_threads SET score=score+new.value-old.value WHERE id=new.thread_id;
 END IF;
 RETURN NULL;
END $$;
CREATE TRIGGER community_vote_counter_trigger AFTER INSERT OR UPDATE OR DELETE
 ON public.community_thread_votes FOR EACH ROW EXECUTE FUNCTION public.community_vote_counter();

CREATE TABLE public.community_saved_threads(
 thread_id uuid NOT NULL REFERENCES public.community_threads(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(thread_id,user_id)
);
CREATE INDEX community_saved_user_idx ON public.community_saved_threads(user_id,created_at DESC);
ALTER TABLE public.community_saved_threads ENABLE ROW LEVEL SECURITY;
GRANT SELECT,INSERT,DELETE ON public.community_saved_threads TO authenticated;
CREATE POLICY community_saved_read ON public.community_saved_threads FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY community_saved_insert ON public.community_saved_threads FOR INSERT TO authenticated
 WITH CHECK(user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.community_threads t WHERE t.id=thread_id AND t.status='published'));
CREATE POLICY community_saved_delete ON public.community_saved_threads FOR DELETE TO authenticated USING(user_id=auth.uid());

CREATE OR REPLACE FUNCTION public.community_manage_thread(p_thread uuid,p_action text)
RETURNS public.community_threads LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_actor uuid:=auth.uid();board uuid;res public.community_threads%ROWTYPE;
BEGIN
 SELECT community_id INTO board FROM public.community_threads WHERE id=p_thread;
 IF board IS NULL THEN RAISE EXCEPTION 'Thread unavailable' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.community_members m WHERE m.community_id=board AND m.user_id=v_actor
 AND m.role IN ('owner','moderator')) THEN RAISE EXCEPTION 'Moderator required' USING ERRCODE='42501'; END IF;
 IF p_action NOT IN ('pin','unpin','lock','unlock','remove','restore') THEN RAISE EXCEPTION 'Unknown action'; END IF;
 UPDATE public.community_threads SET
 is_pinned=CASE WHEN p_action='pin' THEN true WHEN p_action='unpin' THEN false ELSE is_pinned END,
 is_locked=CASE WHEN p_action='lock' THEN true WHEN p_action='unlock' THEN false ELSE is_locked END,
 status=CASE WHEN p_action='remove' THEN 'removed' WHEN p_action='restore' THEN 'published' ELSE status END,
 updated_at=now() WHERE id=p_thread RETURNING * INTO res;
 RETURN res;
END $$;
REVOKE ALL ON FUNCTION public.community_manage_thread(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.community_manage_thread(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.community_set_member_role(p_community uuid,p_member uuid,p_role text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF p_role NOT IN ('member','moderator') THEN RAISE EXCEPTION 'Invalid member role'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.discussion_topics t WHERE t.id=p_community AND t.author_id=auth.uid()) THEN
  RAISE EXCEPTION 'Community owner required' USING ERRCODE='42501';
 END IF;
 UPDATE public.community_members SET role=p_role WHERE community_id=p_community AND user_id=p_member AND role<>'owner';
 IF NOT FOUND THEN RAISE EXCEPTION 'Member unavailable' USING ERRCODE='22023'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.community_set_member_role(uuid,uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.community_set_member_role(uuid,uuid,text) TO authenticated;
