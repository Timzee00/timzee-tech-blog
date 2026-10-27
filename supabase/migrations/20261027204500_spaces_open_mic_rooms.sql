-- Existing rooms retain host-approved requests; newly created Spaces use open-mic by default.
-- Server remains the source of truth for who may publish LiveKit microphone audio.
ALTER TABLE public.spaces_rooms
 ADD COLUMN IF NOT EXISTS speaking_mode text NOT NULL DEFAULT 'request';
ALTER TABLE public.spaces_rooms
 DROP CONSTRAINT IF EXISTS spaces_rooms_speaking_mode_valid;
ALTER TABLE public.spaces_rooms
 ADD CONSTRAINT spaces_rooms_speaking_mode_valid CHECK (speaking_mode IN ('open','request'));
ALTER TABLE public.spaces_rooms ALTER COLUMN speaking_mode SET DEFAULT 'open';

CREATE OR REPLACE FUNCTION public.spaces_join(p_room uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $function$
DECLARE r public.spaces_rooms%ROWTYPE; current_role text;
BEGIN
 IF (SELECT auth.uid()) IS NULL THEN
   RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501';
 END IF;
 SELECT * INTO r FROM public.spaces_rooms WHERE id=p_room FOR UPDATE;
 IF NOT FOUND OR r.status<>'live'
    OR now()>r.starts_at+make_interval(mins=>r.max_duration_minutes) THEN
   RAISE EXCEPTION 'Room is not live' USING ERRCODE='22023';
 END IF;
 IF r.visibility='invite' AND r.owner_id<>(SELECT auth.uid()) AND NOT EXISTS(
    SELECT 1 FROM public.spaces_invites i WHERE i.room_id=p_room
      AND i.user_id=(SELECT auth.uid())) THEN
   RAISE EXCEPTION 'Invitation required' USING ERRCODE='42501';
 END IF;
 IF EXISTS(
    SELECT 1 FROM public.spaces_participants WHERE room_id=p_room
       AND user_id=(SELECT auth.uid()) AND state='removed') THEN
   RAISE EXCEPTION 'Access to this room has been removed' USING ERRCODE='42501';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.spaces_participants WHERE room_id=p_room
   AND user_id=(SELECT auth.uid()) AND state='present')
   AND r.owner_id<>(SELECT auth.uid()) AND (
    SELECT count(*) FROM public.spaces_participants WHERE room_id=p_room
    AND state='present' AND last_seen_at>now()-interval '2 minutes'
   )>=r.capacity THEN
   RAISE EXCEPTION 'Room is full' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.spaces_participants(room_id,user_id,role,state,last_seen_at)
 VALUES(p_room,(SELECT auth.uid()),
   CASE WHEN r.owner_id=(SELECT auth.uid()) THEN 'host'
     WHEN r.speaking_mode='open' THEN 'speaker' ELSE 'listener' END,
   'present',now())
 ON CONFLICT(room_id,user_id) DO UPDATE
 SET state='present',last_seen_at=now(),
 role=CASE
   WHEN r.owner_id=(SELECT auth.uid()) THEN 'host'
   WHEN r.speaking_mode='open' AND public.spaces_participants.role='listener' THEN 'speaker'
   ELSE public.spaces_participants.role END
 WHERE public.spaces_participants.state<>'removed';
 SELECT role INTO current_role FROM public.spaces_participants
 WHERE room_id=p_room AND user_id=(SELECT auth.uid()) AND state='present';
 RETURN current_role;
END $function$;
-- Retain the existing authenticated EXECUTE grant and avoid public access.
REVOKE ALL ON FUNCTION public.spaces_join(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spaces_join(uuid) TO authenticated;
