
-- Real-time audio room control plane; RTP/audio flows through LiveKit, not Supabase.
CREATE TABLE IF NOT EXISTS public.spaces_rooms(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 workspace_id uuid REFERENCES public.team_workspaces(id) ON DELETE SET NULL,
 post_id uuid REFERENCES public.posts(id) ON DELETE SET NULL,
 community_id uuid REFERENCES public.discussion_topics(id) ON DELETE SET NULL,
 title text NOT NULL CHECK(char_length(btrim(title)) BETWEEN 4 AND 120),
 description text NOT NULL DEFAULT '' CHECK(char_length(description)<=700),
 visibility text NOT NULL DEFAULT 'public' CHECK(visibility IN ('public','unlisted','invite')),
 status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','live','ended')),
 starts_at timestamptz NOT NULL DEFAULT now(),
 max_duration_minutes integer NOT NULL DEFAULT 30 CHECK(max_duration_minutes BETWEEN 10 AND 60),
 capacity integer NOT NULL DEFAULT 25 CHECK(capacity BETWEEN 5 AND 50),
 allow_requests boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 ended_at timestamptz,
 CONSTRAINT spaces_room_creation_safe CHECK(status='scheduled' OR ended_at IS NOT NULL OR ended_at IS NULL)
);
CREATE INDEX IF NOT EXISTS spaces_room_public_idx ON public.spaces_rooms(status,starts_at DESC) WHERE visibility='public';
CREATE INDEX IF NOT EXISTS spaces_room_owner_idx ON public.spaces_rooms(owner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.spaces_participants (
 room_id uuid NOT NULL REFERENCES public.spaces_rooms(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 role text NOT NULL CHECK(role IN ('host','speaker','listener')),
 state text NOT NULL DEFAULT 'present' CHECK(state IN ('present','left','removed')),
 joined_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(room_id,user_id)
);
CREATE INDEX IF NOT EXISTS spaces_participants_active_idx ON public.spaces_participants(room_id,last_seen_at DESC) WHERE state='present';
CREATE TABLE IF NOT EXISTS public.spaces_invites(
 room_id uuid NOT NULL REFERENCES public.spaces_rooms(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(room_id,user_id)
);
CREATE INDEX IF NOT EXISTS spaces_invites_user_idx ON public.spaces_invites(user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS public.spaces_speaker_requests(
 room_id uuid NOT NULL REFERENCES public.spaces_rooms(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','denied')),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(room_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.spaces_reports(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 room_id uuid NOT NULL REFERENCES public.spaces_rooms(id) ON DELETE CASCADE,
 reporter_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 reported_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 reason text NOT NULL CHECK(char_length(btrim(reason)) BETWEEN 10 AND 500),
 created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION private.space_is_participant(p_room uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT (SELECT auth.uid()) IS NOT NULL AND EXISTS(
 SELECT 1 FROM public.spaces_participants p
 WHERE p.room_id=p_room AND p.user_id=(SELECT auth.uid()) AND p.state='present')
$fn$;
CREATE OR REPLACE FUNCTION private.space_can_view(p_room uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT EXISTS(SELECT 1 FROM public.spaces_rooms r WHERE r.id=p_room AND
  (r.visibility='public' OR r.owner_id=(SELECT auth.uid())
   OR EXISTS(SELECT 1 FROM public.spaces_invites i WHERE i.room_id=r.id AND i.user_id=(SELECT auth.uid()))
   OR EXISTS(SELECT 1 FROM public.spaces_participants p WHERE p.room_id=r.id
      AND p.user_id=(SELECT auth.uid()) AND p.state='present')))
$fn$;
REVOKE ALL ON FUNCTION private.space_is_participant(uuid),private.space_can_view(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.space_is_participant(uuid),private.space_can_view(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.spaces_create_host()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 INSERT INTO public.spaces_participants(room_id,user_id,role)
 VALUES(NEW.id,NEW.owner_id,'host');
 RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS spaces_create_host ON public.spaces_rooms;
CREATE TRIGGER spaces_create_host AFTER INSERT ON public.spaces_rooms
FOR EACH ROW EXECUTE FUNCTION private.spaces_create_host();

ALTER TABLE public.spaces_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaces_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaces_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaces_speaker_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.spaces_reports ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS spaces_room_visible ON public.spaces_rooms;
CREATE POLICY spaces_room_visible ON public.spaces_rooms FOR SELECT TO authenticated
 USING (private.space_can_view(id));
DROP POLICY IF EXISTS spaces_room_guest_public ON public.spaces_rooms;
CREATE POLICY spaces_room_guest_public ON public.spaces_rooms FOR SELECT TO anon
 USING(visibility='public' AND status IN ('scheduled','live'));
DROP POLICY IF EXISTS spaces_room_create ON public.spaces_rooms;
CREATE POLICY spaces_room_create ON public.spaces_rooms FOR INSERT TO authenticated
 WITH CHECK (owner_id=(SELECT auth.uid()) AND status='scheduled' AND ended_at IS NULL
 AND starts_at BETWEEN now()-interval '5 minutes' AND now()+interval '90 days'
 AND (workspace_id IS NULL OR private.team_role(workspace_id) IN ('owner','admin','editor')));
DROP POLICY IF EXISTS spaces_participants_read ON public.spaces_participants;
CREATE POLICY spaces_participants_read ON public.spaces_participants FOR SELECT TO authenticated
 USING(private.space_is_participant(room_id));
DROP POLICY IF EXISTS spaces_invites_read ON public.spaces_invites;
CREATE POLICY spaces_invites_read ON public.spaces_invites FOR SELECT TO authenticated
 USING(user_id=(SELECT auth.uid()) OR EXISTS(
 SELECT 1 FROM public.spaces_rooms r WHERE r.id=room_id AND r.owner_id=(SELECT auth.uid())));
DROP POLICY IF EXISTS spaces_requests_read ON public.spaces_speaker_requests;
CREATE POLICY spaces_requests_read ON public.spaces_speaker_requests FOR SELECT TO authenticated
 USING(user_id=(SELECT auth.uid()) OR EXISTS(
 SELECT 1 FROM public.spaces_rooms r WHERE r.id=room_id AND r.owner_id=(SELECT auth.uid())));
DROP POLICY IF EXISTS spaces_reports_insert ON public.spaces_reports;
CREATE POLICY spaces_reports_insert ON public.spaces_reports FOR INSERT TO authenticated
 WITH CHECK(reporter_id=(SELECT auth.uid()) AND private.space_is_participant(room_id));
DROP POLICY IF EXISTS spaces_reports_read_self ON public.spaces_reports;
CREATE POLICY spaces_reports_read_self ON public.spaces_reports FOR SELECT TO authenticated
 USING(reporter_id=(SELECT auth.uid()));

GRANT SELECT,INSERT ON public.spaces_rooms TO authenticated;
GRANT SELECT ON public.spaces_rooms TO anon;
GRANT SELECT ON public.spaces_participants,public.spaces_invites,public.spaces_speaker_requests TO authenticated;
GRANT SELECT,INSERT ON public.spaces_reports TO authenticated;

CREATE OR REPLACE FUNCTION public.spaces_start(p_room uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 UPDATE public.spaces_rooms SET status='live'
 WHERE id=p_room AND owner_id=(SELECT auth.uid()) AND status='scheduled'
 AND starts_at<=now()+interval '10 minutes'
 AND now()<=starts_at+interval '30 minutes';
 RETURN FOUND;
END $fn$;
CREATE OR REPLACE FUNCTION public.spaces_end(p_room uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 UPDATE public.spaces_rooms SET status='ended',ended_at=now()
 WHERE id=p_room AND owner_id=(SELECT auth.uid()) AND status IN ('live','scheduled');
 RETURN FOUND;
END $fn$;

CREATE OR REPLACE FUNCTION public.spaces_invite(p_room uuid,p_user uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF p_user=(SELECT auth.uid()) OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user)
 OR NOT EXISTS(SELECT 1 FROM public.spaces_rooms WHERE id=p_room AND owner_id=(SELECT auth.uid()) AND status<>'ended')
 THEN RAISE EXCEPTION 'Invitation is not allowed' USING ERRCODE='42501'; END IF;
 INSERT INTO public.spaces_invites(room_id,user_id,invited_by) VALUES(p_room,p_user,(SELECT auth.uid()))
 ON CONFLICT(room_id,user_id) DO NOTHING;
 RETURN true;
END $fn$;

CREATE OR REPLACE FUNCTION public.spaces_join(p_room uuid)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
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
END $fn$;

CREATE OR REPLACE FUNCTION public.spaces_heartbeat(p_room uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 UPDATE public.spaces_participants SET last_seen_at=now()
 WHERE room_id=p_room AND user_id=(SELECT auth.uid()) AND state='present'
 AND EXISTS(SELECT 1 FROM public.spaces_rooms r WHERE r.id=p_room AND r.status='live'
 AND now()<=r.starts_at+make_interval(mins=>r.max_duration_minutes));
 RETURN FOUND;
END $fn$;
CREATE OR REPLACE FUNCTION public.spaces_leave(p_room uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 UPDATE public.spaces_participants SET state='left',last_seen_at=now()
 WHERE room_id=p_room AND user_id=(SELECT auth.uid()) AND state='present';
 RETURN FOUND;
END $fn$;
CREATE OR REPLACE FUNCTION public.spaces_request_speaker(p_room uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE last_request timestamptz;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.spaces_rooms r JOIN public.spaces_participants p
 ON p.room_id=r.id WHERE r.id=p_room AND r.status='live' AND r.allow_requests
 AND p.user_id=(SELECT auth.uid()) AND p.role='listener' AND p.state='present')
 THEN RAISE EXCEPTION 'Not eligible to request a microphone' USING ERRCODE='42501'; END IF;
 SELECT updated_at INTO last_request FROM public.spaces_speaker_requests WHERE room_id=p_room
 AND user_id=(SELECT auth.uid());
 IF last_request IS NOT NULL AND last_request>now()-interval '1 minute' THEN
 RAISE EXCEPTION 'Please wait before requesting again' USING ERRCODE='22023'; END IF;
 INSERT INTO public.spaces_speaker_requests(room_id,user_id) VALUES(p_room,(SELECT auth.uid()))
 ON CONFLICT(room_id,user_id) DO UPDATE SET status='pending',updated_at=now();
 RETURN true;
END $fn$;
CREATE OR REPLACE FUNCTION public.spaces_review_speaker(p_room uuid,p_user uuid,p_approve boolean)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.spaces_rooms WHERE id=p_room AND owner_id=(SELECT auth.uid())
 AND status='live') THEN RAISE EXCEPTION 'Host permission required' USING ERRCODE='42501'; END IF;
 UPDATE public.spaces_speaker_requests SET status=CASE WHEN p_approve THEN 'approved' ELSE 'denied' END,
 updated_at=now() WHERE room_id=p_room AND user_id=p_user AND status='pending';
 IF NOT FOUND THEN RETURN false; END IF;
 IF p_approve THEN UPDATE public.spaces_participants SET role='speaker'
 WHERE room_id=p_room AND user_id=p_user AND state='present' AND role='listener'; END IF;
 RETURN true;
END $fn$;
REVOKE ALL ON FUNCTION public.spaces_start(uuid),public.spaces_end(uuid),public.spaces_invite(uuid,uuid),
 public.spaces_join(uuid),public.spaces_leave(uuid),public.spaces_heartbeat(uuid),
 public.spaces_request_speaker(uuid),public.spaces_review_speaker(uuid,uuid,boolean) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.spaces_start(uuid),public.spaces_end(uuid),public.spaces_invite(uuid,uuid),
 public.spaces_join(uuid),public.spaces_leave(uuid),public.spaces_heartbeat(uuid),
 public.spaces_request_speaker(uuid),public.spaces_review_speaker(uuid,uuid,boolean) TO authenticated;
