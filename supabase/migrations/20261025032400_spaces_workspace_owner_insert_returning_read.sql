-- Allow room/workspace owners to immediately read records they have just
-- inserted, including INSERT ... RETURNING used by the browser.
-- Existing membership/invite visibility and authenticated scope are preserved.
DO $verify$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_policies
   WHERE schemaname='public' AND tablename='spaces_rooms'
     AND policyname='spaces_room_visible' AND cmd='SELECT'
 ) THEN
   RAISE EXCEPTION 'Expected Space read policy missing; refusing to modify access';
 END IF;
 IF NOT EXISTS (
   SELECT 1 FROM pg_catalog.pg_policies
   WHERE schemaname='public' AND tablename='team_workspaces'
     AND policyname='team_read' AND cmd='SELECT'
 ) THEN
   RAISE EXCEPTION 'Expected workspace read policy missing; refusing to modify access';
 END IF;
END $verify$;
ALTER POLICY spaces_room_visible ON public.spaces_rooms
  USING ((owner_id = (SELECT auth.uid())) OR private.space_can_view(id));
ALTER POLICY team_read ON public.team_workspaces
  USING ((owner_id = (SELECT auth.uid())) OR private.team_role(id) IS NOT NULL);
