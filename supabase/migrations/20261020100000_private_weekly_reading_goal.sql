-- Opt-in weekly learning goals. Count distinct finished articles, not pageviews.
-- No public streaks, no notifications, no ranking manipulation.
CREATE INDEX IF NOT EXISTS article_reading_completed_week_idx
 ON public.article_reading_progress(user_id,completed_at DESC)
 WHERE completed_at IS NOT NULL;
CREATE OR REPLACE FUNCTION public.reader_weekly_completion_count()
RETURNS integer LANGUAGE sql STABLE SECURITY INVOKER
SET search_path=pg_catalog,public
AS $function$
 SELECT count(*)::integer
 FROM public.article_reading_progress r
 WHERE r.user_id=(SELECT auth.uid())
   AND r.completed_at>=date_trunc('week',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
   AND r.completed_at<(date_trunc('week',now() AT TIME ZONE 'UTC')+interval '7 days') AT TIME ZONE 'UTC'
$function$;
REVOKE ALL ON FUNCTION public.reader_weekly_completion_count()
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.reader_weekly_completion_count() TO authenticated;
