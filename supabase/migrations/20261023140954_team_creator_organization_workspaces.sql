
-- Team/creator studio foundation. Independent of paid voice infrastructure.
CREATE TABLE IF NOT EXISTS public.team_workspaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('creator','organization')),
 name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
 description text NOT NULL DEFAULT '' CHECK (char_length(description)<=2000),
 website text CHECK (website IS NULL OR (website ~ '^https://[^[:space:]]+$' AND char_length(website)<=300)),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_workspaces_owner_idx ON public.team_workspaces(owner_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.team_workspace_members (
 workspace_id uuid NOT NULL REFERENCES public.team_workspaces(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 role text NOT NULL CHECK (role IN ('admin','editor','viewer')),
 status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active')),
 invited_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
 joined_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,user_id)
);
CREATE INDEX IF NOT EXISTS team_members_user_idx ON public.team_workspace_members(user_id,status);

CREATE TABLE IF NOT EXISTS public.team_studio_projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES public.team_workspaces(id) ON DELETE CASCADE,
 created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 kind text NOT NULL CHECK (kind IN ('brief','article','video-script','event-plan','announcement')),
 status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved')),
 title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 2 AND 180),
 body text NOT NULL DEFAULT '' CHECK (char_length(body)<=20000),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS team_projects_by_workspace_idx ON public.team_studio_projects(workspace_id,updated_at DESC,id DESC);

CREATE OR REPLACE FUNCTION private.team_role(p_workspace uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
 SELECT CASE WHEN w.owner_id=(SELECT auth.uid()) THEN 'owner'
 ELSE (SELECT m.role FROM public.team_workspace_members m
       WHERE m.workspace_id=w.id AND m.user_id=(SELECT auth.uid()) AND m.status='active') END
 FROM public.team_workspaces w WHERE w.id=p_workspace
$fn$;
REVOKE ALL ON FUNCTION private.team_role(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION private.team_role(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION private.team_immutable_fields()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF TG_TABLE_NAME='team_workspaces' AND
   (OLD.owner_id IS DISTINCT FROM NEW.owner_id OR OLD.kind IS DISTINCT FROM NEW.kind
    OR OLD.created_at IS DISTINCT FROM NEW.created_at OR OLD.id IS DISTINCT FROM NEW.id)
   THEN RAISE EXCEPTION 'Workspace identity cannot be changed' USING ERRCODE='42501';
 END IF;
 IF TG_TABLE_NAME='team_studio_projects' AND
   (OLD.workspace_id IS DISTINCT FROM NEW.workspace_id OR OLD.created_by IS DISTINCT FROM NEW.created_by
    OR OLD.created_at IS DISTINCT FROM NEW.created_at OR OLD.id IS DISTINCT FROM NEW.id)
   THEN RAISE EXCEPTION 'Project ownership cannot be changed' USING ERRCODE='42501';
 END IF;
 NEW.updated_at=now();
 RETURN NEW;
END $fn$;
DROP TRIGGER IF EXISTS team_workspaces_immutable ON public.team_workspaces;
CREATE TRIGGER team_workspaces_immutable BEFORE UPDATE ON public.team_workspaces
 FOR EACH ROW EXECUTE FUNCTION private.team_immutable_fields();
DROP TRIGGER IF EXISTS team_projects_immutable ON public.team_studio_projects;
CREATE TRIGGER team_projects_immutable BEFORE UPDATE ON public.team_studio_projects
 FOR EACH ROW EXECUTE FUNCTION private.team_immutable_fields();

ALTER TABLE public.team_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.team_studio_projects ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS team_read ON public.team_workspaces;
CREATE POLICY team_read ON public.team_workspaces FOR SELECT TO authenticated
 USING (private.team_role(id) IS NOT NULL);
DROP POLICY IF EXISTS team_create ON public.team_workspaces;
CREATE POLICY team_create ON public.team_workspaces FOR INSERT TO authenticated
 WITH CHECK (owner_id=(SELECT auth.uid()));
DROP POLICY IF EXISTS team_update_owner ON public.team_workspaces;
CREATE POLICY team_update_owner ON public.team_workspaces FOR UPDATE TO authenticated
 USING (owner_id=(SELECT auth.uid())) WITH CHECK (owner_id=(SELECT auth.uid()));
DROP POLICY IF EXISTS team_members_read ON public.team_workspace_members;
CREATE POLICY team_members_read ON public.team_workspace_members FOR SELECT TO authenticated
 USING (user_id=(SELECT auth.uid()) OR private.team_role(workspace_id) IN ('owner','admin'));
DROP POLICY IF EXISTS team_projects_read ON public.team_studio_projects;
CREATE POLICY team_projects_read ON public.team_studio_projects FOR SELECT TO authenticated
 USING (private.team_role(workspace_id) IS NOT NULL);
DROP POLICY IF EXISTS team_projects_insert ON public.team_studio_projects;
CREATE POLICY team_projects_insert ON public.team_studio_projects FOR INSERT TO authenticated
 WITH CHECK (created_by=(SELECT auth.uid()) AND status='draft'
  AND private.team_role(workspace_id) IN ('owner','admin','editor'));
DROP POLICY IF EXISTS team_projects_update ON public.team_studio_projects;
CREATE POLICY team_projects_update ON public.team_studio_projects FOR UPDATE TO authenticated
 USING (private.team_role(workspace_id) IN ('owner','admin','editor'))
 WITH CHECK (private.team_role(workspace_id) IN ('owner','admin','editor'));
DROP POLICY IF EXISTS team_projects_delete ON public.team_studio_projects;
CREATE POLICY team_projects_delete ON public.team_studio_projects FOR DELETE TO authenticated
 USING (private.team_role(workspace_id) IN ('owner','admin'));

-- Membership changes are always atomic RPCs; no direct INSERT/UPDATE/DELETE grants.
GRANT SELECT,INSERT,UPDATE ON public.team_workspaces TO authenticated;
GRANT SELECT ON public.team_workspace_members TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.team_studio_projects TO authenticated;

CREATE OR REPLACE FUNCTION public.team_invite_member(p_workspace uuid,p_user uuid,p_role text DEFAULT 'editor')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
DECLARE caller_role text;
BEGIN
 caller_role:=private.team_role(p_workspace);
 IF caller_role NOT IN ('owner','admin') OR p_role NOT IN ('admin','editor','viewer')
    OR (caller_role='admin' AND p_role='admin') THEN
  RAISE EXCEPTION 'Not authorized to invite this role' USING ERRCODE='42501';
 END IF;
 IF p_user IS NULL OR p_user=(SELECT auth.uid()) OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id=p_user) THEN
  RAISE EXCEPTION 'Choose an existing different account' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM public.team_workspaces WHERE id=p_workspace AND owner_id=p_user) THEN
  RAISE EXCEPTION 'The workspace owner is already a member' USING ERRCODE='22023';
 END IF;
 PERFORM 1 FROM public.team_workspaces WHERE id=p_workspace FOR UPDATE;
 IF (SELECT count(*) FROM public.team_workspace_members WHERE workspace_id=p_workspace)>=20 THEN
  RAISE EXCEPTION 'Team capacity reached' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM public.team_workspace_members WHERE workspace_id=p_workspace AND user_id=p_user) THEN
  RAISE EXCEPTION 'Member or invitation already exists' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.team_workspace_members(workspace_id,user_id,role,invited_by)
 VALUES(p_workspace,p_user,p_role,(SELECT auth.uid()));
END $fn$;
CREATE OR REPLACE FUNCTION public.team_accept_invite(p_workspace uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 UPDATE public.team_workspace_members SET status='active',joined_at=now()
 WHERE workspace_id=p_workspace AND user_id=(SELECT auth.uid()) AND status='invited';
 RETURN FOUND;
END $fn$;
CREATE OR REPLACE FUNCTION public.team_remove_member(p_workspace uuid,p_user uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $fn$
BEGIN
 IF private.team_role(p_workspace)<>'owner' THEN
  RAISE EXCEPTION 'Only workspace owners may remove members' USING ERRCODE='42501';
 END IF;
 DELETE FROM public.team_workspace_members WHERE workspace_id=p_workspace AND user_id=p_user;
 RETURN FOUND;
END $fn$;
REVOKE ALL ON FUNCTION public.team_invite_member(uuid,uuid,text),public.team_accept_invite(uuid),
 public.team_remove_member(uuid,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.team_invite_member(uuid,uuid,text),public.team_accept_invite(uuid),
 public.team_remove_member(uuid,uuid) TO authenticated;
