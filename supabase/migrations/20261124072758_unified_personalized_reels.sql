-- Unify public post-gallery videos with Reels and personalize discovery from real viewing signals.
-- Private messages are never read or mirrored by this pipeline.

ALTER TABLE public.videos
  ADD COLUMN IF NOT EXISTS source_post_id uuid REFERENCES public.posts(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS source_media_id uuid REFERENCES public.post_media(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS videos_source_media_unique
  ON public.videos(source_media_id) WHERE source_media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS videos_source_post_idx
  ON public.videos(source_post_id) WHERE source_post_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS post_media_video_post_idx
  ON public.post_media(post_id, id) WHERE media_type = 'video';

-- Source-linked rows can only be created/changed by the database sync trigger.
DROP POLICY IF EXISTS "Blipmood client cannot insert post video mirrors" ON public.videos;
CREATE POLICY "Blipmood client cannot insert post video mirrors" ON public.videos
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (source_post_id IS NULL AND source_media_id IS NULL);
DROP POLICY IF EXISTS "Blipmood client cannot update post video mirrors" ON public.videos;
CREATE POLICY "Blipmood client cannot update post video mirrors" ON public.videos
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (source_post_id IS NULL AND source_media_id IS NULL)
  WITH CHECK (source_post_id IS NULL AND source_media_id IS NULL);
DROP POLICY IF EXISTS "Blipmood client cannot delete post video mirrors" ON public.videos;
CREATE POLICY "Blipmood client cannot delete post video mirrors" ON public.videos
  AS RESTRICTIVE FOR DELETE TO authenticated
  USING (source_post_id IS NULL AND source_media_id IS NULL);

-- Permit only database-verified public post media to use the internal mirror path.
-- Keep the original managed-storage and capacity checks unchanged for direct uploads.
CREATE OR REPLACE FUNCTION private.platform_video_upload_gate()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_catalog', 'public', 'storage'
AS $function$
DECLARE
  file_path text;
  bytes bigint;
  max_bytes bigint;
  total_bytes bigint;
  budget bigint;
  pause_pct integer;
BEGIN
  IF NEW.source_media_id IS NOT NULL OR NEW.source_post_id IS NOT NULL THEN
    IF NEW.source_media_id IS NULL OR NEW.source_post_id IS NULL OR NOT EXISTS (
      SELECT 1
      FROM public.post_media pm
      JOIN public.posts p ON p.id = pm.post_id
      WHERE pm.id = NEW.source_media_id
        AND pm.post_id = NEW.source_post_id
        AND pm.media_type = 'video'
        AND pm.url = NEW.video_url
        AND p.author_id = NEW.user_id
        AND p.status = 'published'
        AND (p.publish_at IS NULL OR p.publish_at <= (now() AT TIME ZONE 'UTC'))
    ) THEN
      RAISE EXCEPTION 'Invalid public post video source' USING ERRCODE='42501';
    END IF;
    RETURN NEW;
  END IF;

  IF auth.uid() IS DISTINCT FROM NEW.user_id OR NOT public.blipmood_feature_allowed('video_uploads') THEN
    RAISE EXCEPTION 'Video uploads are unavailable for this account or region' USING ERRCODE='42501';
  END IF;
  SELECT max_video_upload_bytes, media_budget_bytes, upload_pause_pct
    INTO max_bytes, budget, pause_pct
    FROM public.platform_capacity_settings WHERE singleton = true;
  IF NEW.video_url NOT LIKE '%/storage/v1/object/public/media/videos/%' THEN
    RAISE EXCEPTION 'New videos must come from managed public video storage' USING ERRCODE='22023';
  END IF;
  file_path := split_part(NEW.video_url, '/storage/v1/object/public/media/', 2);
  file_path := split_part(file_path, '?', 1);
  IF file_path NOT LIKE 'videos/' || NEW.user_id::text || '/%' THEN
    RAISE EXCEPTION 'Video does not belong to this uploader' USING ERRCODE='42501';
  END IF;
  SELECT (o.metadata->>'size')::bigint INTO bytes
    FROM storage.objects o
    WHERE o.bucket_id = 'media' AND o.name = file_path LIMIT 1;
  IF bytes IS NULL OR bytes <= 0 THEN
    RAISE EXCEPTION 'Video object not found in managed storage' USING ERRCODE='22023';
  END IF;
  SELECT coalesce(sum((o.metadata->>'size')::bigint), 0) INTO total_bytes
    FROM storage.objects o WHERE o.bucket_id = 'media';
  IF total_bytes * 100 >= budget * pause_pct THEN
    RAISE EXCEPTION 'Media upload capacity safeguard is active' USING ERRCODE='54000';
  END IF;
  IF total_bytes * 100 >= budget * 80 THEN
    max_bytes := least(max_bytes, 6291456);
  END IF;
  IF bytes > max_bytes THEN
    RAISE EXCEPTION 'Video file exceeds the available storage upload limit' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION private.sync_post_media_video(p_post_id uuid, p_media_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  media_row public.post_media%ROWTYPE;
  post_row public.posts%ROWTYPE;
BEGIN
  SELECT * INTO media_row
  FROM public.post_media
  WHERE id = p_media_id AND post_id = p_post_id;

  IF NOT FOUND THEN
    DELETE FROM public.videos WHERE source_media_id = p_media_id;
    RETURN;
  END IF;

  IF media_row.media_type IS DISTINCT FROM 'video' OR media_row.url IS NULL THEN
    DELETE FROM public.videos WHERE source_media_id = p_media_id;
    RETURN;
  END IF;

  SELECT * INTO post_row FROM public.posts WHERE id = p_post_id;
  IF NOT FOUND THEN
    DELETE FROM public.videos WHERE source_media_id = p_media_id;
    RETURN;
  END IF;

  IF post_row.status IS DISTINCT FROM 'published'
     OR (post_row.publish_at IS NOT NULL AND post_row.publish_at > (now() AT TIME ZONE 'UTC'))
     OR post_row.author_id IS NULL THEN
    UPDATE public.videos SET is_public = false, updated_at = now()
    WHERE source_media_id = p_media_id;
    RETURN;
  END IF;

  INSERT INTO public.videos(
    id, user_id, author_name, title, description, video_url, thumbnail_url,
    duration, tags, category, is_public, view_count, like_count, comment_count,
    created_at, updated_at, source_post_id, source_media_id
  ) VALUES (
    gen_random_uuid(), post_row.author_id, post_row.author_name,
    post_row.title,
    left(coalesce(nullif(post_row.feed_excerpt, ''), regexp_replace(coalesce(post_row.content, ''), '<[^>]*>', ' ', 'g')), 1800),
    media_row.url, post_row.cover, NULL, coalesce(post_row.tags, '{}'::text[]),
    coalesce(nullif(post_row.content_type, ''), 'Posts'), true, 0, 0, 0,
    coalesce(media_row.created_at, post_row.created_at, now()), now(),
    post_row.id, media_row.id
  )
  ON CONFLICT (source_media_id) WHERE source_media_id IS NOT NULL
  DO UPDATE SET
    user_id = EXCLUDED.user_id,
    author_name = EXCLUDED.author_name,
    title = EXCLUDED.title,
    description = EXCLUDED.description,
    video_url = EXCLUDED.video_url,
    thumbnail_url = EXCLUDED.thumbnail_url,
    tags = EXCLUDED.tags,
    category = EXCLUDED.category,
    is_public = true,
    source_post_id = EXCLUDED.source_post_id,
    updated_at = now();
END
$function$;

REVOKE ALL ON FUNCTION private.sync_post_media_video(uuid, uuid) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.sync_post_media_video_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM public.videos WHERE source_media_id = OLD.id;
    RETURN OLD;
  END IF;
  PERFORM private.sync_post_media_video(NEW.post_id, NEW.id);
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION private.sync_post_media_video_trigger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS post_media_video_discovery_sync ON public.post_media;
CREATE TRIGGER post_media_video_discovery_sync
AFTER INSERT OR UPDATE OR DELETE ON public.post_media
FOR EACH ROW EXECUTE FUNCTION private.sync_post_media_video_trigger();

CREATE OR REPLACE FUNCTION private.sync_post_video_media_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  media_id uuid;
BEGIN
  FOR media_id IN
    SELECT pm.id FROM public.post_media pm
    WHERE pm.post_id = NEW.id AND pm.media_type = 'video'
  LOOP
    PERFORM private.sync_post_media_video(NEW.id, media_id);
  END LOOP;
  RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION private.sync_post_video_media_trigger() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS posts_video_discovery_sync ON public.posts;
CREATE TRIGGER posts_video_discovery_sync
AFTER UPDATE OF status, publish_at, author_id, title, content, feed_excerpt, cover, tags, content_type
ON public.posts
FOR EACH ROW EXECUTE FUNCTION private.sync_post_video_media_trigger();

-- Rebuild mirrors from existing published post galleries. The operation is idempotent.
DO $function$
DECLARE
  media_row record;
BEGIN
  FOR media_row IN
    SELECT pm.post_id, pm.id
    FROM public.post_media pm
    JOIN public.posts p ON p.id = pm.post_id
    WHERE pm.media_type = 'video'
      AND p.status = 'published'
      AND (p.publish_at IS NULL OR p.publish_at <= (now() AT TIME ZONE 'UTC'))
    ORDER BY pm.created_at DESC
    LIMIT 5000
  LOOP
    PERFORM private.sync_post_media_video(media_row.post_id, media_row.id);
  END LOOP;
END
$function$;

-- Private per-viewer learning signals. Direct writes are allowed only through the
-- authenticated, bounded RPC below; each viewer can read only their own rows.
CREATE TABLE IF NOT EXISTS public.video_watch_signals (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  watched_on date NOT NULL,
  watch_seconds integer NOT NULL DEFAULT 0 CHECK (watch_seconds BETWEEN 0 AND 3600),
  completion_count smallint NOT NULL DEFAULT 0 CHECK (completion_count BETWEEN 0 AND 10),
  last_watched_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, video_id, watched_on)
);
CREATE INDEX IF NOT EXISTS video_watch_signals_user_recent_idx
  ON public.video_watch_signals(user_id, last_watched_at DESC);
CREATE INDEX IF NOT EXISTS video_watch_signals_video_day_idx
  ON public.video_watch_signals(video_id, watched_on DESC);
ALTER TABLE public.video_watch_signals ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_watch_signals FROM PUBLIC;
GRANT SELECT ON public.video_watch_signals TO anon, authenticated;
DROP POLICY IF EXISTS "Members read own video watch signals" ON public.video_watch_signals;
CREATE POLICY "Members read own video watch signals" ON public.video_watch_signals
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE TABLE IF NOT EXISTS public.video_user_topic_affinity (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  topic text NOT NULL CHECK (length(topic) BETWEEN 2 AND 48),
  score numeric NOT NULL DEFAULT 0 CHECK (score BETWEEN 0 AND 1000),
  last_engaged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, topic)
);
CREATE INDEX IF NOT EXISTS video_user_topic_affinity_rank_idx
  ON public.video_user_topic_affinity(user_id, score DESC, last_engaged_at DESC);
ALTER TABLE public.video_user_topic_affinity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.video_user_topic_affinity FROM PUBLIC;
GRANT SELECT ON public.video_user_topic_affinity TO anon, authenticated;
DROP POLICY IF EXISTS "Members read own video topic affinity" ON public.video_user_topic_affinity;
CREATE POLICY "Members read own video topic affinity" ON public.video_user_topic_affinity
  FOR SELECT TO authenticated USING (user_id = (SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.record_video_watch_signal(
  p_video_id uuid,
  p_watch_seconds integer,
  p_completed boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  viewer_id uuid := (SELECT auth.uid());
  video_tags text[];
  video_category text;
  seconds_to_add integer := least(90, greatest(0, coalesce(p_watch_seconds, 0)));
  previous_seconds integer := 0;
  previous_completions integer := 0;
  total_seconds integer := 0;
  total_completions integer := 0;
  credited_seconds integer := 0;
  credited_completions integer := 0;
  topic_delta numeric := 0;
BEGIN
  IF viewer_id IS NULL OR p_video_id IS NULL THEN RETURN false; END IF;
  SELECT v.tags, v.category INTO video_tags, video_category
  FROM public.videos v
  WHERE v.id = p_video_id AND v.is_public IS TRUE;
  IF NOT FOUND THEN RETURN false; END IF;
  IF seconds_to_add < 3 AND coalesce(p_completed, false) IS NOT TRUE THEN
    RETURN false;
  END IF;

  SELECT w.watch_seconds, w.completion_count
    INTO previous_seconds, previous_completions
  FROM public.video_watch_signals w
  WHERE w.user_id = viewer_id
    AND w.video_id = p_video_id
    AND w.watched_on = (now() AT TIME ZONE 'UTC')::date
  FOR UPDATE;
  previous_seconds := coalesce(previous_seconds, 0);
  previous_completions := coalesce(previous_completions, 0);

  INSERT INTO public.video_watch_signals(
    user_id, video_id, watched_on, watch_seconds, completion_count, last_watched_at
  ) VALUES (
    viewer_id, p_video_id, (now() AT TIME ZONE 'UTC')::date,
    least(3600, seconds_to_add), CASE WHEN coalesce(p_completed, false) THEN 1 ELSE 0 END, now()
  )
  ON CONFLICT (user_id, video_id, watched_on) DO UPDATE SET
    watch_seconds = least(3600, public.video_watch_signals.watch_seconds + EXCLUDED.watch_seconds),
    completion_count = least(10, public.video_watch_signals.completion_count + EXCLUDED.completion_count),
    last_watched_at = now()
  RETURNING watch_seconds, completion_count INTO total_seconds, total_completions;

  credited_seconds := greatest(0, least(seconds_to_add, 3600 - previous_seconds));
  credited_completions := greatest(0, total_completions - previous_completions);
  topic_delta := (least(credited_seconds, 60)::numeric / 60.0) + (credited_completions * 1.5);

  IF topic_delta > 0 THEN
    WITH topics AS (
      SELECT DISTINCT lower(btrim(t.topic)) AS topic
      FROM unnest(coalesce(video_tags, '{}'::text[]) || ARRAY[coalesce(video_category, '')]) AS t(topic)
      WHERE length(btrim(t.topic)) BETWEEN 2 AND 48
        AND lower(btrim(t.topic)) ~ '^[a-z0-9][a-z0-9 _-]*$'
    )
    INSERT INTO public.video_user_topic_affinity(user_id, topic, score, last_engaged_at)
    SELECT viewer_id, topic, least(1000, topic_delta), now() FROM topics
    ON CONFLICT (user_id, topic) DO UPDATE SET
      score = least(1000, public.video_user_topic_affinity.score + EXCLUDED.score),
      last_engaged_at = now();

    DELETE FROM public.video_user_topic_affinity a
    WHERE a.user_id = viewer_id
      AND a.topic NOT IN (
        SELECT keep.topic FROM public.video_user_topic_affinity keep
        WHERE keep.user_id = viewer_id
        ORDER BY keep.score DESC, keep.last_engaged_at DESC
        LIMIT 40
      );
  END IF;
  RETURN true;
END
$function$;
REVOKE ALL ON FUNCTION public.record_video_watch_signal(uuid, integer, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_watch_signal(uuid, integer, boolean) TO authenticated;

-- A video like is another explicit positive topic signal.
CREATE OR REPLACE FUNCTION private.adjust_video_topic_affinity_from_like()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  target_user uuid;
  target_video uuid;
  delta numeric;
  video_tags text[];
  video_category text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_user := OLD.user_id;
    target_video := OLD.video_id;
    delta := -4;
  ELSE
    target_user := NEW.user_id;
    target_video := NEW.video_id;
    delta := 4;
  END IF;

  SELECT v.tags, v.category INTO video_tags, video_category
  FROM public.videos v WHERE v.id = target_video AND v.is_public IS TRUE;
  IF NOT FOUND THEN RETURN NULL; END IF;

  IF delta > 0 THEN
    WITH topics AS (
      SELECT DISTINCT lower(btrim(t.topic)) AS topic
      FROM unnest(coalesce(video_tags, '{}'::text[]) || ARRAY[coalesce(video_category, '')]) AS t(topic)
      WHERE length(btrim(t.topic)) BETWEEN 2 AND 48
        AND lower(btrim(t.topic)) ~ '^[a-z0-9][a-z0-9 _-]*$'
    )
    INSERT INTO public.video_user_topic_affinity(user_id, topic, score, last_engaged_at)
    SELECT target_user, topic, delta, now() FROM topics
    ON CONFLICT (user_id, topic) DO UPDATE SET
      score = least(1000, public.video_user_topic_affinity.score + EXCLUDED.score),
      last_engaged_at = now();
  ELSE
    UPDATE public.video_user_topic_affinity a
    SET score = greatest(0, a.score + delta), last_engaged_at = now()
    WHERE a.user_id = target_user
      AND a.topic IN (
        SELECT lower(btrim(t.topic))
        FROM unnest(coalesce(video_tags, '{}'::text[]) || ARRAY[coalesce(video_category, '')]) AS t(topic)
        WHERE length(btrim(t.topic)) BETWEEN 2 AND 48
          AND lower(btrim(t.topic)) ~ '^[a-z0-9][a-z0-9 _-]*$'
      );
  END IF;

  DELETE FROM public.video_user_topic_affinity a
  WHERE a.user_id = target_user
    AND a.topic NOT IN (
      SELECT keep.topic FROM public.video_user_topic_affinity keep
      WHERE keep.user_id = target_user
      ORDER BY keep.score DESC, keep.last_engaged_at DESC
      LIMIT 40
    );
  RETURN NULL;
END
$function$;
REVOKE ALL ON FUNCTION private.adjust_video_topic_affinity_from_like() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS video_likes_topic_affinity ON public.video_likes;
CREATE TRIGGER video_likes_topic_affinity
AFTER INSERT OR DELETE ON public.video_likes
FOR EACH ROW EXECUTE FUNCTION private.adjust_video_topic_affinity_from_like();

-- Keep recommendation history bounded while preserving aggregate video counters.
CREATE OR REPLACE FUNCTION private.prune_video_watch_signals(p_batch integer DEFAULT 4000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE removed integer := 0;
BEGIN
  WITH old_rows AS (
    SELECT ctid FROM public.video_watch_signals
    WHERE watched_on < ((now() AT TIME ZONE 'UTC')::date - 90)
    ORDER BY watched_on ASC
    LIMIT least(greatest(coalesce(p_batch, 4000), 100), 4000)
  )
  DELETE FROM public.video_watch_signals w
  WHERE w.ctid IN (SELECT ctid FROM old_rows);
  GET DIAGNOSTICS removed = ROW_COUNT;
  RETURN removed;
END
$function$;
REVOKE ALL ON FUNCTION private.prune_video_watch_signals(integer) FROM PUBLIC, anon, authenticated;

DO $function$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'blipmood-video-watch-signal-prune') THEN
    PERFORM cron.schedule(
      'blipmood-video-watch-signal-prune',
      '17 3 * * *',
      'select private.prune_video_watch_signals(4000);'
    );
  END IF;
END
$function$;

-- Per-viewer ranking over the shared bounded pool: interests, followed creators,
-- recent watch fatigue and creator diversity. RLS still scopes private signals.
CREATE OR REPLACE FUNCTION public.blipmood_video_feed_ids(
  p_mode text DEFAULT 'for-you',
  p_limit integer DEFAULT 50
)
RETURNS TABLE(video_id uuid)
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = pg_catalog, public
AS $function$
WITH viewer AS (
  SELECT auth.uid() AS id
),
candidate_scores AS (
  SELECT
    v.id AS video_id,
    v.user_id,
    max(CASE WHEN c.lane = 'trending' THEN c.score ELSE c.score * 12 END)
      + CASE WHEN EXISTS (
          SELECT 1 FROM public.follows f
          WHERE f.follower_id = (SELECT id FROM viewer)
            AND f.target_type = 'author'
            AND f.target_id = v.user_id::text
        ) THEN 7 ELSE 0 END
      + least(18::numeric, coalesce((
          SELECT sum(least(a.score, 24) * 0.45)
          FROM public.video_user_topic_affinity a
          WHERE a.user_id = (SELECT id FROM viewer)
            AND (
              a.topic = lower(coalesce(v.category, ''))
              OR a.topic IN (
                SELECT lower(tag.value)
                FROM unnest(coalesce(v.tags, '{}'::text[])) AS tag(value)
              )
            )
        ), 0))
      - CASE WHEN EXISTS (
          SELECT 1 FROM public.video_watch_signals w
          WHERE w.user_id = (SELECT id FROM viewer)
            AND w.video_id = v.id
            AND w.watched_on >= ((now() AT TIME ZONE 'UTC')::date - 3)
            AND w.watch_seconds >= 12
        ) THEN 8 ELSE 0 END AS score,
    max(v.created_at) AS added
  FROM public.blipmood_video_candidates c
  JOIN public.videos v ON v.id = c.video_id
  WHERE v.is_public IS TRUE
    AND (p_mode = 'following' OR public.blipmood_feature_allowed('fyp_recommendations'))
    AND (
      p_mode = 'for-you'
      OR (p_mode = 'following' AND EXISTS (
        SELECT 1 FROM public.follows f
        WHERE f.follower_id = (SELECT id FROM viewer)
          AND f.target_type = 'author'
          AND f.target_id = v.user_id::text
      ))
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.user_content_feedback n
      WHERE n.user_id = (SELECT id FROM viewer)
        AND n.content_type = 'video'
        AND n.content_id = v.id
        AND n.action IN ('not_interested', 'hide')
    )
  GROUP BY v.id, v.user_id, v.tags, v.category
),
diverse AS (
  SELECT
    c.*,
    row_number() OVER (
      PARTITION BY c.user_id
      ORDER BY c.score DESC, c.added DESC, c.video_id DESC
    ) AS creator_position
  FROM candidate_scores c
)
SELECT d.video_id
FROM diverse d
WHERE p_mode IN ('for-you', 'following')
ORDER BY
  d.score - least(12::numeric, greatest(0, d.creator_position - 1) * 3.5) DESC,
  d.added DESC,
  d.video_id DESC
LIMIT least(50, greatest(1, coalesce(p_limit, 50)));
$function$;

REVOKE ALL ON FUNCTION public.blipmood_video_feed_ids(text, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.blipmood_video_feed_ids(text, integer) TO anon, authenticated;

-- The read RPC is invoker-secured, so the private signals need explicit SELECT
-- grants plus owner-only RLS. No client role receives INSERT/UPDATE/DELETE.
SELECT private.refresh_blipmood_video_candidates();
