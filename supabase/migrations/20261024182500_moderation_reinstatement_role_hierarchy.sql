CREATE OR REPLACE FUNCTION public.staff_lift_account_restriction(p_actor uuid, p_target uuid, p_reason text, p_request uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_role text;v_target_role text;v_active bigint;v_audit bigint;
 v_issuer uuid;v_issuer_role text;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role'
 THEN RAISE EXCEPTION 'Server-only' USING ERRCODE='42501';END IF;
 IF p_actor IS NULL OR p_target IS NULL OR p_request IS NULL
    OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 20 AND 2000
 THEN RAISE EXCEPTION 'Reason and identifiers are required' USING ERRCODE='22023'; END IF;
 SELECT lower(coalesce(role,'user')) INTO v_role
 FROM public.profiles WHERE id=p_actor AND account_status='active' FOR SHARE;
 IF v_role NOT IN ('moderator','admin','super') THEN
  RAISE EXCEPTION 'Moderator unavailable' USING ERRCODE='42501'; END IF;
 IF p_target=p_actor THEN RAISE EXCEPTION 'Self-restoration is prohibited' USING ERRCODE='42501';END IF;
 SELECT lower(coalesce(role,'user')) INTO v_target_role
 FROM public.profiles WHERE id=p_target FOR UPDATE;
 IF v_target_role IS DISTINCT FROM 'user' THEN
  RAISE EXCEPTION 'Only standard accounts can be restored here' USING ERRCODE='42501';END IF;
 SELECT id INTO v_audit FROM public.moderation_audit WHERE request_id=p_request;
 IF FOUND THEN RETURN jsonb_build_object('ok',true,'replayed',true,'auditId',v_audit);END IF;
 SELECT id,actor_id INTO v_active,v_issuer FROM public.moderation_account_actions
  WHERE target_id=p_target AND lifted_at IS NULL AND action IN ('suspend_24h','suspend_7d','ban')
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No active suspension or ban' USING ERRCODE='P0002';END IF;
 SELECT lower(coalesce(role,'user')) INTO v_issuer_role FROM public.profiles WHERE id=v_issuer;
 IF (v_role='moderator' AND v_issuer IS DISTINCT FROM p_actor)
   OR (v_role='admin' AND v_issuer_role='super') THEN
  RAISE EXCEPTION 'A higher-privileged reviewer must lift this restriction' USING ERRCODE='42501';
 END IF;
 UPDATE public.moderation_account_actions SET lifted_at=now()
  WHERE id=v_active;
 UPDATE public.profiles SET account_status='active' WHERE id=p_target
  AND account_status IN ('suspended','banned');
 INSERT INTO public.moderation_account_actions(target_id,actor_id,action,reason)
 VALUES(p_target,p_actor,'reinstate',btrim(p_reason));
 INSERT INTO public.moderation_audit
  (moderator_id,moderator_role,action,content_type,content_id,details,request_id)
 VALUES(p_actor,v_role,'reinstate','profiles',p_target::text,
  jsonb_build_object('previous_sanction',v_active,'reason',left(btrim(p_reason),1000)),p_request)
 RETURNING id INTO v_audit;
 PERFORM public.emit_user_notification(p_target,'account_moderation',
 'Account access restored','Your account restriction has been lifted.',
 '/profile.html',jsonb_build_object('restored',true,'audit_id',v_audit));
 RETURN jsonb_build_object('ok',true,'replayed',false,'auditId',v_audit);
END $function$
;
REVOKE ALL ON FUNCTION public.staff_lift_account_restriction(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_lift_account_restriction(uuid,uuid,text,uuid) TO service_role;
