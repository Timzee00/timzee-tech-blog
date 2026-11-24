-- Aggregate visible discussion replies once per RPC call instead of running
-- two or three correlated COUNT(*) index scans for every topic.
-- These remain SECURITY INVOKER SQL functions, so the caller's existing RLS
-- visibility on discussion_topics and discussion_messages is preserved.

CREATE OR REPLACE FUNCTION public.get_popular_discussion_topics(limit_count integer DEFAULT 5)
RETURNS TABLE(
  id uuid,
  title text,
  description text,
  author_id uuid,
  author_name text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  reply_count bigint,
  recent_reply_count bigint,
  popularity_score numeric
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH reply_counts AS (
    SELECT
      m.topic_id,
      count(*)::bigint AS reply_count,
      count(*) FILTER (
        WHERE m.created_at >= now() - interval '14 days'
      )::bigint AS recent_reply_count
    FROM public.discussion_messages AS m
    GROUP BY m.topic_id
  )
  SELECT
    t.id,
    t.title,
    t.description,
    t.author_id,
    t.author_name,
    t.created_at,
    t.updated_at,
    coalesce(rc.reply_count, 0)::bigint AS reply_count,
    coalesce(rc.recent_reply_count, 0)::bigint AS recent_reply_count,
    round((
      coalesce(rc.reply_count, 0) * 2
      + ln(coalesce(rc.reply_count, 0) + 1) * 3
    )::numeric, 6) AS popularity_score
  FROM public.discussion_topics AS t
  LEFT JOIN reply_counts AS rc ON rc.topic_id = t.id
  ORDER BY popularity_score DESC, coalesce(t.created_at, t.updated_at) DESC
  LIMIT greatest(1, least(coalesce(limit_count, 5), 20));
$function$;

CREATE OR REPLACE FUNCTION public.get_trending_discussion_topics(limit_count integer DEFAULT 5)
RETURNS TABLE(
  id uuid,
  title text,
  description text,
  author_id uuid,
  author_name text,
  created_at timestamp with time zone,
  updated_at timestamp with time zone,
  reply_count bigint,
  recent_reply_count bigint,
  trending_score numeric
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH reply_counts AS (
    SELECT
      m.topic_id,
      count(*)::bigint AS reply_count,
      count(*) FILTER (
        WHERE m.created_at >= now() - interval '72 hours'
      )::bigint AS recent_reply_count,
      count(*) FILTER (
        WHERE m.created_at >= now() - interval '24 hours'
      )::bigint AS very_recent_reply_count
    FROM public.discussion_messages AS m
    GROUP BY m.topic_id
  )
  SELECT
    t.id,
    t.title,
    t.description,
    t.author_id,
    t.author_name,
    t.created_at,
    t.updated_at,
    coalesce(rc.reply_count, 0)::bigint AS reply_count,
    coalesce(rc.recent_reply_count, 0)::bigint AS recent_reply_count,
    round((
      coalesce(rc.recent_reply_count, 0) * 5
      + coalesce(rc.very_recent_reply_count, 0) * 4
      + ln(coalesce(rc.reply_count, 0) + 1)
    )::numeric, 6) AS trending_score
  FROM public.discussion_topics AS t
  LEFT JOIN reply_counts AS rc ON rc.topic_id = t.id
  ORDER BY trending_score DESC, coalesce(t.updated_at, t.created_at) DESC
  LIMIT greatest(1, least(coalesce(limit_count, 5), 20));
$function$;
