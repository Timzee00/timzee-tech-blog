-- Community recommendations v2: bounded multi-source retrieval, reason labels,
-- author/board diversification and score-keyset pagination.
-- This deliberately does NOT profile scrolling time or covertly track attention.
CREATE INDEX IF NOT EXISTS community_threads_rank_fresh_v2
 ON public.community_threads (created_at DESC,id DESC) WHERE status='published';
CREATE INDEX IF NOT EXISTS community_threads_rank_active_v2
 ON public.community_threads (last_activity_at DESC,id DESC) WHERE status='published';
CREATE INDEX IF NOT EXISTS community_threads_rank_top_v2
 ON public.community_threads (score DESC,created_at DESC,id DESC) WHERE status='published';

CREATE OR REPLACE FUNCTION public.community_personal_feed_v2(
 p_limit integer DEFAULT 20,
 p_after_score numeric DEFAULT NULL,
 p_after_created timestamptz DEFAULT NULL,
 p_after_id uuid DEFAULT NULL,
 p_as_of timestamptz DEFAULT NULL
)
RETURNS TABLE(
 id uuid,community_id uuid,author_id uuid,author_name text,title text,body text,kind text,
 status text,is_pinned boolean,is_locked boolean,is_legacy_room boolean,reply_count integer,
 score integer,created_at timestamptz,last_activity_at timestamptz,media_url text,media_type text,
 ranking_reason text,recommendation_score numeric
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public
AS $$
WITH config AS (
 SELECT least(greatest(coalesce(p_limit,20),1),20) take,
 auth.uid() actor,
 CASE WHEN p_as_of IS NOT NULL AND p_as_of BETWEEN now()-interval '4 hours' AND now()+interval '1 minute'
      THEN p_as_of ELSE date_trunc('minute',now()) END anchor
),
candidate_ids AS MATERIALIZED (
 SELECT id FROM (
  (SELECT t.id FROM public.community_threads t,config cfg
   WHERE t.status='published' AND t.created_at<=cfg.anchor
   ORDER BY t.created_at DESC,t.id DESC LIMIT 250)
  UNION
  (SELECT t.id FROM public.community_threads t,config cfg
   WHERE t.status='published' AND t.created_at<=cfg.anchor
   AND t.created_at>=cfg.anchor-interval '180 days'
   ORDER BY t.last_activity_at DESC,t.id DESC LIMIT 250)
  UNION
  (SELECT t.id FROM public.community_threads t,config cfg
   WHERE t.status='published' AND t.created_at<=cfg.anchor
   AND t.created_at>=cfg.anchor-interval '90 days'
   ORDER BY t.score DESC,t.created_at DESC,t.id DESC LIMIT 150)
  UNION
  (SELECT t.id FROM public.community_members membership
   JOIN public.community_threads t ON t.community_id=membership.community_id
   CROSS JOIN config cfg
   WHERE cfg.actor IS NOT NULL AND membership.user_id=cfg.actor
   AND t.status='published' AND t.created_at<=cfg.anchor
   ORDER BY t.created_at DESC,t.id DESC LIMIT 150)
 ) sources
),
safe_candidates AS MATERIALIZED (
 SELECT t.id,t.community_id,t.author_id,t.author_name,t.title,t.body,t.kind,t.status,
 t.is_pinned,t.is_locked,t.is_legacy_room,t.reply_count,t.score,t.created_at,
 t.last_activity_at,t.media_url,t.media_type,
 c.category,
 (cfg.actor IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.community_members membership
  WHERE membership.community_id=t.community_id AND membership.user_id=cfg.actor)) joined,
 (cfg.actor IS NOT NULL AND EXISTS(
  SELECT 1 FROM public.community_user_interests interest
  WHERE interest.user_id=cfg.actor AND interest.topic=c.category)) interested
 FROM candidate_ids ids
 JOIN public.community_threads t ON t.id=ids.id
 JOIN public.discussion_topics c ON c.id=t.community_id
 CROSS JOIN config cfg
 WHERE t.status='published' AND c.community_state='active'
 AND public.community_can_read(t.community_id,cfg.actor)
 AND NOT EXISTS (
   SELECT 1 FROM public.community_feed_feedback f
   WHERE f.thread_id=t.id AND f.user_id=cfg.actor
 )
 -- Suppress posts that were manually or automatically queued for moderation.
 AND NOT EXISTS (
  SELECT 1 FROM public.community_auto_moderation flag
  WHERE flag.target_type='thread' AND flag.target_id=t.id
  AND flag.state='pending' AND flag.risk_score>=70
 )
),
signals AS (
 SELECT c.*,
 row_number() OVER (PARTITION BY c.community_id
   ORDER BY c.last_activity_at DESC,c.created_at DESC,c.id DESC) community_position,
 row_number() OVER (PARTITION BY coalesce(c.author_id::text,c.id::text)
   ORDER BY c.last_activity_at DESC,c.id DESC) author_position,
 (
   CASE WHEN c.joined THEN 2.0 ELSE 0.0 END
  +CASE WHEN c.interested THEN 1.8 ELSE 0.0 END
  +least(ln(1+greatest(c.reply_count,0)),ln(51.0))*0.8
  +least(ln(1+greatest(c.score,0)),ln(51.0))*0.65
  -least(ln(1+greatest(-c.score,0)),ln(51.0))*0.75
  +3.2*exp(-greatest(extract(epoch FROM(cfg.anchor-c.created_at))/86400.0,0)/12.0)
  +1.6*exp(-greatest(extract(epoch FROM(cfg.anchor-c.last_activity_at))/86400.0,0)/7.0)
 ) raw_score
 FROM safe_candidates c CROSS JOIN config cfg
),
ranked AS (
 SELECT s.*,
 round((
 s.raw_score
 -least(greatest(s.community_position-2,0),8)*0.9
 -least(greatest(s.author_position-2,0),8)*1.05
 )::numeric,4) weight,
 CASE WHEN s.joined THEN 'From a community you joined'
      WHEN s.interested THEN 'Matches an interest you selected'
      WHEN s.reply_count>=5 THEN 'Useful ongoing conversation'
      WHEN s.score>=4 THEN 'Appreciated by readers'
      ELSE 'Discover a new conversation' END why
 FROM signals s
)
SELECT r.id,r.community_id,r.author_id,r.author_name,r.title,r.body,r.kind,
 r.status,r.is_pinned,r.is_locked,r.is_legacy_room,r.reply_count,r.score,
 r.created_at,r.last_activity_at,r.media_url,r.media_type,r.why,r.weight
FROM ranked r
WHERE (p_after_score IS NULL AND p_after_created IS NULL AND p_after_id IS NULL)
 OR (p_after_score IS NOT NULL AND p_after_created IS NOT NULL AND p_after_id IS NOT NULL
 AND (r.weight,r.created_at,r.id)<(p_after_score,p_after_created,p_after_id))
ORDER BY r.weight DESC,r.created_at DESC,r.id DESC
LIMIT (SELECT take FROM config);
$$;
REVOKE ALL ON FUNCTION public.community_personal_feed_v2(integer,numeric,timestamptz,uuid,timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_personal_feed_v2(integer,numeric,timestamptz,uuid,timestamptz) TO anon,authenticated;
