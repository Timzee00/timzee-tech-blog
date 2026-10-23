-- Use actual go-live timestamp for room durations and LiveKit token eligibility.
-- Scheduled rooms may start up to ten minutes early, but before this fix
-- the token endpoint rejected their microphones until the original start.
CREATE OR REPLACE FUNCTION public.spaces_start(p_room uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 UPDATE public.spaces_rooms SET status='live', starts_at=now()
 WHERE id=p_room AND owner_id=(SELECT auth.uid()) AND status='scheduled'
 AND starts_at<=now()+interval '10 minutes'
 AND now()<=starts_at+make_interval(mins=>max_duration_minutes);
 RETURN FOUND;
END $function$
