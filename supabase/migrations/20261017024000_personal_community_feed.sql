
-- Explicit preferences rather than hidden attention tracking.
CREATE TABLE IF NOT EXISTS public.community_user_interests(
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 topic text NOT NULL CHECK(length(topic) BETWEEN 2 AND 40),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,topic)
);
CREATE INDEX IF NOT EXISTS community_user_interests_topic_idx ON public.community_user_interests(topic,user_id);
ALTER TABLE public.community_user_interests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_user_interests FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.community_user_interests TO authenticated;
CREATE POLICY community_interests_own_read ON public.community_user_interests FOR SELECT TO authenticated
USING(user_id=auth.uid());
CREATE POLICY community_interests_own_insert ON public.community_user_interests FOR INSERT TO authenticated
WITH CHECK(user_id=auth.uid() AND topic IN (
 'AI & ML','Programming','Gadgets','Cybersecurity','Tech Jobs','Gaming',
 'Startups','Learning','Technology','Project Showcase','Sports','Entertainment','World Affairs','General'
));
CREATE POLICY community_interests_own_delete ON public.community_user_interests FOR DELETE TO authenticated
USING(user_id=auth.uid());

CREATE TABLE IF NOT EXISTS public.community_feed_feedback(
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 thread_id uuid NOT NULL REFERENCES public.community_threads(id) ON DELETE CASCADE,
 feedback text NOT NULL CHECK(feedback='not_interested'),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,thread_id)
);
CREATE INDEX IF NOT EXISTS community_feedback_user_idx ON public.community_feed_feedback(user_id,created_at DESC);
ALTER TABLE public.community_feed_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_feed_feedback FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.community_feed_feedback TO authenticated;
CREATE POLICY community_feedback_own_read ON public.community_feed_feedback FOR SELECT TO authenticated USING(user_id=auth.uid());
CREATE POLICY community_feedback_own_insert ON public.community_feed_feedback FOR INSERT TO authenticated WITH CHECK(user_id=auth.uid());
CREATE POLICY community_feedback_own_delete ON public.community_feed_feedback FOR DELETE TO authenticated USING(user_id=auth.uid());

-- Candidate selection is bounded; the scorer favors useful and diverse communities.
-- No opaque vendor model or per-user behavior profiling.
CREATE OR REPLACE FUNCTION public.community_personal_feed(
 p_limit integer DEFAULT 20,p_offset integer DEFAULT 0
) RETURNS TABLE(
 id uuid,community_id uuid,author_id uuid,author_name text,title text,body text,kind text,
 status text,is_pinned boolean,is_locked boolean,is_legacy_room boolean,reply_count integer,
 score integer,created_at timestamptz,last_activity_at timestamptz,media_url text,media_type text,
 ranking_reason text,recommendation_score numeric
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH
 settings AS(
 SELECT least(greatest(coalesce(p_limit,20),1),20) amount,
 least(greatest(coalesce(p_offset,0),0),200) skip,
 auth.uid() actor
 ),
 candidates AS(
  SELECT t.id,t.community_id,t.author_id,t.author_name,t.title,t.body,t.kind,
  t.status,t.is_pinned,t.is_locked,t.is_legacy_room,t.reply_count,t.score,
  t.created_at,t.last_activity_at,t.media_url,t.media_type,
  c.category,c.title community_title,
  EXISTS(SELECT 1 FROM public.community_members m,settings s WHERE m.community_id=t.community_id AND m.user_id=s.actor) joined,
  EXISTS(SELECT 1 FROM public.community_user_interests i,settings s WHERE i.user_id=s.actor AND i.topic=c.category) interested
  FROM public.community_threads t
  JOIN public.discussion_topics c ON c.id=t.community_id
  WHERE t.status='published' AND c.community_state='active'
    AND public.community_can_read(t.community_id,auth.uid())
    AND t.created_at>now()-interval '180 days'
    AND NOT EXISTS(SELECT 1 FROM public.community_feed_feedback f
      WHERE f.thread_id=t.id AND f.user_id=auth.uid())
  ORDER BY t.created_at DESC LIMIT 600
 ),
 scored AS(
 SELECT c.*,
  (
  1.9*CASE WHEN c.interested THEN 1 ELSE 0 END +
  2.1*CASE WHEN c.joined THEN 1 ELSE 0 END +
  ln(1+greatest(c.reply_count,0)) * 0.9+
  ln(1+greatest(c.score,0)) * 0.7+
  3.5*exp(-greatest(extract(epoch FROM(now()-c.created_at))/86400,0)/9.0)+
  1.5*exp(-greatest(extract(epoch FROM(now()-c.last_activity_at))/86400,0)/5.0)
  ) base_score,
  row_number() OVER(PARTITION BY c.community_id ORDER BY c.last_activity_at DESC,c.id DESC) diversity_position
 FROM candidates c
 ),
 results AS(
 SELECT s.*,round((s.base_score -
  greatest(s.diversity_position-3,0)*1.4)::numeric,3) weight,
 CASE WHEN s.joined THEN 'From a community you joined'
 WHEN s.interested THEN 'Matches your selected interests'
 WHEN s.reply_count>3 THEN 'Active conversation'
 ELSE 'Discover something new' END explanation
 FROM scored s
 )
 SELECT r.id,r.community_id,r.author_id,r.author_name,r.title,r.body,r.kind,
 r.status,r.is_pinned,r.is_locked,r.is_legacy_room,r.reply_count,r.score,
 r.created_at,r.last_activity_at,r.media_url,r.media_type,r.explanation,r.weight
 FROM results r
 ORDER BY r.weight DESC,r.created_at DESC,r.id DESC
 OFFSET (SELECT skip FROM settings) LIMIT(SELECT amount FROM settings);
$$;
REVOKE ALL ON FUNCTION public.community_personal_feed(integer,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_personal_feed(integer,integer) TO anon,authenticated;

-- Honor privacy in the helper itself even when callers supply arbitrary IDs.
CREATE OR REPLACE FUNCTION public.community_is_moderator(p_community uuid,p_actor uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
 SELECT p_actor IS NOT DISTINCT FROM auth.uid() AND p_actor IS NOT NULL AND (
  EXISTS(SELECT 1 FROM public.community_members m WHERE m.community_id=p_community
    AND m.user_id=p_actor AND m.role IN ('owner','moderator'))
  OR coalesce(public.has_role_secure('super'),false)
  OR coalesce(public.has_role_secure('admin'),false)
 );
$$;
CREATE OR REPLACE FUNCTION public.community_can_read(p_community uuid,p_actor uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT p_actor IS NOT DISTINCT FROM auth.uid() AND EXISTS(
 SELECT 1 FROM public.discussion_topics c WHERE c.id=p_community
 AND c.community_state<>'archived'
 AND (c.visibility='public'
 OR (p_actor IS NOT NULL AND EXISTS(SELECT 1 FROM public.community_members m
 WHERE m.community_id=c.id AND m.user_id=p_actor))
 OR public.community_is_moderator(c.id,p_actor))
 );
$$;
