
-- Enforce staff/content approval and bounded workspace creation.
ALTER TABLE public.team_studio_projects ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.team_studio_projects ADD COLUMN IF NOT EXISTS approved_at timestamptz;

CREATE OR REPLACE FUNCTION private.team_creation_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.profiles WHERE id=NEW.owner_id AND account_status='active') THEN
   RAISE EXCEPTION 'Only active accounts can open workspaces' USING ERRCODE='42501';
 END IF;
 IF (SELECT count(*) FROM public.team_workspaces
     WHERE owner_id=NEW.owner_id AND kind=NEW.kind)>=3 THEN
   RAISE EXCEPTION 'Workspace type limit reached' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS team_creation_guard ON public.team_workspaces;
CREATE TRIGGER team_creation_guard BEFORE INSERT ON public.team_workspaces
 FOR EACH ROW EXECUTE FUNCTION private.team_creation_guard();

CREATE OR REPLACE FUNCTION private.team_project_approval_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE role text;
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.status<>'draft' THEN
   RAISE EXCEPTION 'New work starts as a draft' USING ERRCODE='42501';
  END IF;
  NEW.approved_by=NULL;NEW.approved_at=NULL;
  RETURN NEW;
 END IF;
 role:=private.team_role(OLD.workspace_id);
 IF NEW.status='approved' AND
 (OLD.status IS DISTINCT FROM NEW.status OR OLD.title IS DISTINCT FROM NEW.title
  OR OLD.body IS DISTINCT FROM NEW.body OR OLD.kind IS DISTINCT FROM NEW.kind)
 THEN
  IF role NOT IN ('owner','admin') THEN
   RAISE EXCEPTION 'An owner or administrator must approve the final content' USING ERRCODE='42501';
  END IF;
  NEW.approved_by=(SELECT auth.uid());NEW.approved_at=now();
 ELSIF NEW.status<>'approved' THEN
  NEW.approved_by=NULL;NEW.approved_at=NULL;
 ELSE
  NEW.approved_by=OLD.approved_by;NEW.approved_at=OLD.approved_at;
 END IF;
 RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS team_project_approval_guard ON public.team_studio_projects;
CREATE TRIGGER team_project_approval_guard BEFORE INSERT OR UPDATE ON public.team_studio_projects
 FOR EACH ROW EXECUTE FUNCTION private.team_project_approval_guard();

-- Invites reveal only their receiving user's workspace names; other teams remain private.
CREATE OR REPLACE FUNCTION public.team_pending_invites()
RETURNS TABLE(workspace_id uuid,workspace_name text,workspace_kind text,role text,invited_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT m.workspace_id,w.name,w.kind,m.role,m.created_at
 FROM public.team_workspace_members m JOIN public.team_workspaces w ON w.id=m.workspace_id
 WHERE m.user_id=(SELECT auth.uid()) AND m.status='invited'
 ORDER BY m.created_at DESC LIMIT 30
$fn$;
REVOKE ALL ON FUNCTION public.team_pending_invites() FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.team_pending_invites() TO authenticated;
REVOKE ALL ON FUNCTION private.team_creation_guard(),private.team_project_approval_guard()
 FROM PUBLIC,anon,authenticated;
