
-- Creator-controlled delegation: group administrators can edit settings and
-- group description only when the creator explicitly enables it.
-- All permission checks are enforced server-side against auth.uid().
CREATE OR REPLACE FUNCTION public.update_chat_group_settings(
  p_group uuid, p_patch jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_owner uuid;
  v_role text;
  v_current jsonb;
  v_new jsonb;
  v_key text;
  v_seconds integer;
BEGIN
  IF v_actor IS NULL OR p_group IS NULL THEN
    RAISE EXCEPTION 'Sign in to manage group settings' USING ERRCODE='42501';
  END IF;
  SELECT created_by, COALESCE(settings, '{}'::jsonb)
    INTO v_owner,v_current
    FROM public.chat_threads WHERE id=p_group AND is_group=true FOR UPDATE;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Group not found' USING ERRCODE='42501';
  END IF;
  IF v_actor<>v_owner THEN
    SELECT role INTO v_role FROM public.chat_members
      WHERE thread_id=p_group AND user_id=v_actor;
    IF v_role IS DISTINCT FROM 'admin'
      OR COALESCE((v_current->>'allow_admin_manage_settings')::boolean,false) IS NOT TRUE
    THEN
      RAISE EXCEPTION 'The group creator has not granted settings access' USING ERRCODE='42501';
    END IF;
  END IF;
  IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' OR p_patch='{}'::jsonb THEN
    RAISE EXCEPTION 'Provide group settings to update' USING ERRCODE='22023';
  END IF;
  FOR v_key IN SELECT jsonb_object_keys(p_patch) LOOP
    IF v_key NOT IN (
      'only_admins_post','allow_media','allow_polls','slow_mode_seconds',
      'allow_members_add_members','allow_moderators_add_members',
      'allow_admin_add_members','allow_invite_links',
      'allow_admin_invite_links','allow_admin_manage_settings'
    ) THEN
      RAISE EXCEPTION 'Unsupported group setting' USING ERRCODE='22023';
    END IF;
    IF v_actor<>v_owner AND v_key='allow_admin_manage_settings' THEN
      RAISE EXCEPTION 'Only creator may delegate admin permissions' USING ERRCODE='42501';
    END IF;
    IF v_key<>'slow_mode_seconds'
      AND jsonb_typeof(p_patch->v_key)<>'boolean' THEN
      RAISE EXCEPTION 'Group permissions must be true or false' USING ERRCODE='22023';
    END IF;
  END LOOP;
  IF p_patch ? 'slow_mode_seconds' THEN
    IF jsonb_typeof(p_patch->'slow_mode_seconds')<>'number' THEN
      RAISE EXCEPTION 'Invalid slow mode' USING ERRCODE='22023';
    END IF;
    BEGIN v_seconds:=(p_patch->>'slow_mode_seconds')::integer;
    EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN
      RAISE EXCEPTION 'Invalid slow mode' USING ERRCODE='22023';
    END;
    IF v_seconds NOT IN (0,15,30,60,300,600,3600) THEN
      RAISE EXCEPTION 'Unsupported slow mode interval' USING ERRCODE='22023';
    END IF;
  END IF;
  v_new:=v_current||p_patch;
  UPDATE public.chat_threads SET settings=v_new,updated_at=now()
    WHERE id=p_group AND is_group=true;
  INSERT INTO private.chat_group_audit(group_id,actor_id,action,details)
    VALUES(p_group,v_actor,'update_settings',p_patch);
  RETURN v_new;
END
$function$;
REVOKE ALL ON FUNCTION public.update_chat_group_settings(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_chat_group_settings(uuid,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_chat_group_details(
  p_group uuid, p_name text, p_description text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO ''
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_owner uuid;
  v_role text;
  v_settings jsonb;
  v_name text:=btrim(COALESCE(p_name,''));
  v_description text:=btrim(COALESCE(p_description,''));
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sign in to edit group details' USING ERRCODE='42501';
  END IF;
  SELECT created_by,COALESCE(settings,'{}'::jsonb) INTO v_owner,v_settings
    FROM public.chat_threads WHERE id=p_group AND is_group=true FOR UPDATE;
  IF v_owner IS NULL THEN RAISE EXCEPTION 'Group unavailable' USING ERRCODE='42501'; END IF;
  IF v_actor<>v_owner THEN
    SELECT role INTO v_role FROM public.chat_members
      WHERE thread_id=p_group AND user_id=v_actor;
    IF v_role IS DISTINCT FROM 'admin' OR
      COALESCE((v_settings->>'allow_admin_manage_settings')::boolean,false) IS NOT TRUE
    THEN RAISE EXCEPTION 'Only the creator or delegated admins can edit details' USING ERRCODE='42501'; END IF;
  END IF;
  IF length(v_name)<1 OR length(v_name)>80 OR length(v_description)>300 THEN
    RAISE EXCEPTION 'Invalid name or description length' USING ERRCODE='22023';
  END IF;
  UPDATE public.chat_threads SET name=v_name,description=v_description,updated_at=now()
    WHERE id=p_group AND is_group=true;
  INSERT INTO private.chat_group_audit(group_id,actor_id,action)
    VALUES(p_group,v_actor,'edit_group_details');
END
$function$;
REVOKE ALL ON FUNCTION public.update_chat_group_details(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.update_chat_group_details(uuid,text,text) TO authenticated;
