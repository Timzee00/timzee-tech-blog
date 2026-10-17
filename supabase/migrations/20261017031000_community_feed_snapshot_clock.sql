-- Server-sourced snapshot clock for deterministic feed pagination.
-- Avoid relying on users' phone clocks when deciding page boundaries.
CREATE OR REPLACE FUNCTION public.community_feed_snapshot_clock()
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
 SELECT date_trunc('minute',now());
$$;
REVOKE ALL ON FUNCTION public.community_feed_snapshot_clock() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_feed_snapshot_clock() TO anon,authenticated;
