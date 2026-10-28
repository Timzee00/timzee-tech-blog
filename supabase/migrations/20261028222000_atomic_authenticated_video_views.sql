-- Real authenticated reel views, deduplicated once per account/video/UTC day.
-- Never rely on client UPDATE to videos.view_count: viewers are not owners.
-- Anonymous viewing is intentionally excluded until a rate-limited
-- anti-abuse public counting pathway is available.
CREATE SCHEMA IF NOT EXISTS app_private;
CREATE TABLE IF NOT EXISTS app_private.video_view_events (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  viewed_on date NOT NULL,
  PRIMARY KEY (user_id, video_id, viewed_on)
);
ALTER TABLE app_private.video_view_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_private.video_view_events FROM PUBLIC, anon, authenticated;
CREATE INDEX IF NOT EXISTS video_view_events_by_video
  ON app_private.video_view_events (video_id, viewed_on DESC);

CREATE OR REPLACE FUNCTION public.record_video_view(p_video_id uuid)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  viewer_id uuid := (SELECT auth.uid());
  added integer := 0;
BEGIN
  IF viewer_id IS NULL OR p_video_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.videos v WHERE v.id=p_video_id AND v.is_public IS TRUE
  ) THEN
    RETURN false;
  END IF;

  INSERT INTO app_private.video_view_events(user_id,video_id,viewed_on)
  VALUES(viewer_id,p_video_id,(now() AT TIME ZONE 'utc')::date)
  ON CONFLICT (user_id,video_id,viewed_on) DO NOTHING;
  GET DIAGNOSTICS added=ROW_COUNT;
  IF added=0 THEN RETURN false; END IF;

  UPDATE public.videos SET view_count=greatest(coalesce(view_count,0),0)+1
  WHERE id=p_video_id AND is_public IS TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Video became unavailable during playback'; END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_video_view(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_video_view(uuid) TO authenticated;
