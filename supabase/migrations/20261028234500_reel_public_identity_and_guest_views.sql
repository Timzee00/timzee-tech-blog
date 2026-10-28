-- Free-tier, privacy-aware reel discovery and guest video view receipts.
-- No email or full name is exposed in the public reel identity endpoint.
-- Public metadata obeys RLS because it is SECURITY INVOKER.
CREATE OR REPLACE FUNCTION public.reel_public_metadata(p_video_ids uuid[])
RETURNS TABLE(video_id uuid, username text, view_count integer)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=''
AS $$
  SELECT v.id, pp.username, GREATEST(COALESCE(v.view_count,0),0)
  FROM (SELECT DISTINCT unnest(p_video_ids[1:50]) AS id) requested
  JOIN public.videos v ON v.id=requested.id AND v.is_public IS TRUE
  LEFT JOIN public.public_profiles pp ON pp.id=v.user_id;
$$;
REVOKE ALL ON FUNCTION public.reel_public_metadata(uuid[]) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reel_public_metadata(uuid[]) TO anon,authenticated;

-- Guest receipts contain only HMAC-SHA256 digests calculated server-side.
-- Raw addresses, account IDs, and user agents are never stored here.
CREATE SCHEMA IF NOT EXISTS app_private;
CREATE TABLE IF NOT EXISTS app_private.video_guest_view_events(
  video_id uuid NOT NULL REFERENCES public.videos(id) ON DELETE CASCADE,
  visitor_hash text NOT NULL CHECK(visitor_hash ~ '^[0-9a-f]{64}$'),
  ip_hash text NOT NULL CHECK(ip_hash ~ '^[0-9a-f]{64}$'),
  viewed_on date NOT NULL,
  PRIMARY KEY(video_id,visitor_hash,viewed_on)
);
ALTER TABLE app_private.video_guest_view_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE app_private.video_guest_view_events FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS video_guest_views_ip_daily_idx
  ON app_private.video_guest_view_events(ip_hash,viewed_on);

-- Called only by a server-side Netlify Function using its service-role key.
-- Anon and ordinary members cannot call it through Supabase Data API.
CREATE OR REPLACE FUNCTION public.record_guest_video_view(
 p_video_id uuid,p_visitor_hash text,p_ip_hash text
)
RETURNS boolean
LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path=''
AS $$
DECLARE
  inserted_rows integer := 0;
  today date := (now() AT TIME ZONE 'utc')::date;
BEGIN
  IF p_video_id IS NULL OR p_visitor_hash !~ '^[0-9a-f]{64}$'
     OR p_ip_hash !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.videos
                WHERE id=p_video_id AND is_public IS TRUE) THEN
    RETURN false;
  END IF;
  -- Limit an anonymous network to 150 different recorded plays per UTC day.
  IF (SELECT count(*) FROM app_private.video_guest_view_events
      WHERE ip_hash=p_ip_hash AND viewed_on=today)>=150 THEN
    RETURN false;
  END IF;
  INSERT INTO app_private.video_guest_view_events(video_id,visitor_hash,ip_hash,viewed_on)
  VALUES(p_video_id,p_visitor_hash,p_ip_hash,today)
  ON CONFLICT (video_id,visitor_hash,viewed_on) DO NOTHING;
  GET DIAGNOSTICS inserted_rows=ROW_COUNT;
  IF inserted_rows=0 THEN RETURN false; END IF;
  UPDATE public.videos
     SET view_count=GREATEST(COALESCE(view_count,0),0)+1
     WHERE id=p_video_id AND is_public IS TRUE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Public video unavailable'; END IF;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.record_guest_video_view(uuid,text,text)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.record_guest_video_view(uuid,text,text)
 TO service_role;
