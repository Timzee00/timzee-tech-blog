-- Prevent shared trigger from resolving OLD/NEW fields of the wrong table.
-- Reproduced before this fix as PostgreSQL 42703 while updating team_workspaces.
CREATE OR REPLACE FUNCTION private.team_immutable_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  IF TG_TABLE_SCHEMA <> 'public' THEN
    RAISE EXCEPTION 'Unexpected workspace trigger schema' USING ERRCODE='42501';
  END IF;

  IF TG_TABLE_NAME = 'team_workspaces' THEN
    IF OLD.owner_id IS DISTINCT FROM NEW.owner_id
       OR OLD.kind IS DISTINCT FROM NEW.kind
       OR OLD.created_at IS DISTINCT FROM NEW.created_at
       OR OLD.id IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'Workspace identity cannot be changed' USING ERRCODE='42501';
    END IF;

  ELSIF TG_TABLE_NAME = 'team_studio_projects' THEN
    IF OLD.workspace_id IS DISTINCT FROM NEW.workspace_id
       OR OLD.created_by IS DISTINCT FROM NEW.created_by
       OR OLD.created_at IS DISTINCT FROM NEW.created_at
       OR OLD.id IS DISTINCT FROM NEW.id THEN
      RAISE EXCEPTION 'Project ownership cannot be changed' USING ERRCODE='42501';
    END IF;

  ELSE
    RAISE EXCEPTION 'Unexpected workspace trigger table' USING ERRCODE='42501';
  END IF;

  NEW.updated_at = now();
  RETURN NEW;
END
$function$
;
