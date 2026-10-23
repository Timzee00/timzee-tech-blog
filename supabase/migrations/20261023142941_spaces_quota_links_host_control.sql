
CREATE OR REPLACE FUNCTION public.spaces_start(p_room uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
 UPDATE public.spaces_rooms SET status='live'
 WHERE id=p_room AND owner_id=(SELECT auth.uid()) AND status='scheduled'
 AND starts_at<=now()+interval '10 minutes'
 AND now()<=starts_at+make_interval(mins=>max_duration_minutes);
 RETURN FOUND;
END $function$
;
CREATE OR REPLACE FUNCTION public.spaces_join(p_room uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE r public.spaces_rooms%ROWTYPE;current_role text;
BEGIN
 IF (SELECT auth.uid()) IS NULL THEN RAISE EXCEPTION 'Sign in required' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM public.spaces_rooms WHERE id=p_room FOR UPDATE;
 IF NOT FOUND OR r.status<>'live' OR now()>r.starts_at+make_interval(mins=>r.max_duration_minutes)
 THEN RAISE EXCEPTION 'Room is not live' USING ERRCODE='22023'; END IF;
 IF r.visibility='invite' AND r.owner_id<>(SELECT auth.uid()) AND NOT EXISTS(
 SELECT 1 FROM public.spaces_invites i WHERE i.room_id=p_room AND i.user_id=(SELECT auth.uid()))
 THEN RAISE EXCEPTION 'Invitation required' USING ERRCODE='42501'; END IF;
 IF EXISTS(SELECT 1 FROM public.spaces_participants WHERE room_id=p_room
 AND user_id=(SELECT auth.uid()) AND state='removed') THEN
 RAISE EXCEPTION 'Access to this room has been removed' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.spaces_participants WHERE room_id=p_room
 AND user_id=(SELECT auth.uid()) AND state='present')
 AND r.owner_id<>(SELECT auth.uid())
 AND (SELECT count(*) FROM public.spaces_participants WHERE room_id=p_room
 AND state='present' AND last_seen_at>now()-interval '2 minutes')>=r.capacity THEN
 RAISE EXCEPTION 'Room is full' USING ERRCODE='22023'; END IF;
 INSERT INTO public.spaces_participants(room_id,user_id,role,state,last_seen_at)
 VALUES(p_room,(SELECT auth.uid()),CASE WHEN r.owner_id=(SELECT auth.uid()) THEN 'host' ELSE 'listener' END,'present',now())
 ON CONFLICT(room_id,user_id) DO UPDATE SET state='present',last_seen_at=now()
 WHERE public.spaces_participants.state<>'removed';
 SELECT role INTO current_role FROM public.spaces_participants WHERE room_id=p_room
 AND user_id=(SELECT auth.uid()) AND state='present';
 RETURN current_role;
END $function$
;
DROP POLICY IF EXISTS spaces_room_create ON public.spaces_rooms;
CREATE POLICY spaces_room_create ON public.spaces_rooms FOR INSERT TO authenticated
 WITH CHECK(owner_id=(SELECT auth.uid()) AND status='scheduled' AND ended_at IS NULL
  AND starts_at BETWEEN now()-interval '5 minutes' AND now()+interval '90 days'
  AND (workspace_id IS NULL OR private.team_role(workspace_id) IN ('owner','admin','editor'))
  AND (post_id IS NULL OR EXISTS(SELECT 1 FROM public.posts p WHERE p.id=post_id AND p.status='published'))
  AND (community_id IS NULL OR public.community_can_read(community_id,(SELECT auth.uid()))));
CREATE OR REPLACE FUNCTION private.spaces_creation_guard()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=NEW.owner_id AND p.account_status='active') THEN
   RAISE EXCEPTION 'Only active accounts can host Spaces' USING ERRCODE='42501';
 END IF;
 IF (SELECT count(*) FROM public.spaces_rooms r WHERE r.owner_id=NEW.owner_id
    AND r.created_at>now()-interval '1 hour')>=6 OR
    (SELECT count(*) FROM public.spaces_rooms r WHERE r.owner_id=NEW.owner_id
     AND r.status IN ('scheduled','live'))>=12 THEN
   RAISE EXCEPTION 'Room quota reached. Try again later' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS spaces_creation_guard ON public.spaces_rooms;
CREATE TRIGGER spaces_creation_guard BEFORE INSERT ON public.spaces_rooms
 FOR EACH ROW EXECUTE FUNCTION private.spaces_creation_guard();
CREATE OR REPLACE FUNCTION public.spaces_remove_participant(p_room uuid,p_user uuid)
 RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.spaces_rooms r WHERE r.id=p_room
 AND r.status='live' AND r.owner_id=(SELECT auth.uid())) OR p_user=(SELECT auth.uid())
 THEN RAISE EXCEPTION 'Only the active host can remove listeners' USING ERRCODE='42501'; END IF;
 UPDATE public.spaces_participants SET state='removed',last_seen_at=now()
 WHERE room_id=p_room AND user_id=p_user AND role<>'host' AND state='present';
 RETURN FOUND;
END $fn$;
REVOKE ALL ON FUNCTION public.spaces_remove_participant(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spaces_remove_participant(uuid,uuid) TO authenticated;
