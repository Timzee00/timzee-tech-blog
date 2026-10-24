CREATE OR REPLACE FUNCTION public.moderate_content_transactional(p_actor uuid, p_type text, p_action text, p_content_id uuid, p_request_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE
 v_role text;
 v_existing public.moderation_audit%ROWTYPE;
 v_table text;
 v_status text;
 v_changed uuid;
 v_audit_id bigint;
BEGIN
 -- Report outcomes must include investigation notes and evidentiary review.
 -- The legacy quick-close RPC cannot bypass the new audited case workflow.
 IF p_type='content_reports' THEN
   RAISE EXCEPTION 'Use investigative report decision workflow' USING ERRCODE='22023';
 END IF;
 IF p_actor IS NULL OR p_content_id IS NULL OR p_request_id IS NULL THEN
  RAISE EXCEPTION 'Missing actor, content or idempotency key' USING ERRCODE='22023';
 END IF;
 -- The server validates the bearer token; the database independently verifies
 -- the actor is still active and privileged at mutation time.
 SELECT lower(coalesce(role,'user')) INTO v_role FROM public.profiles
  WHERE id=p_actor AND account_status='active' FOR SHARE;
 IF v_role NOT IN ('moderator','admin','super') OR v_role IS NULL THEN
  RAISE EXCEPTION 'Moderator access is no longer active' USING ERRCODE='42501';
 END IF;
 -- Serialize concurrent retries of exactly the same request ID.
 PERFORM pg_advisory_xact_lock(hashtextextended(p_request_id::text, 190210));
 SELECT * INTO v_existing FROM public.moderation_audit
  WHERE request_id=p_request_id LIMIT 1;
 IF FOUND THEN
  IF v_existing.moderator_id IS DISTINCT FROM p_actor
   OR v_existing.content_type IS DISTINCT FROM p_type
   OR v_existing.action IS DISTINCT FROM p_action
   OR v_existing.content_id IS DISTINCT FROM p_content_id::text THEN
   RAISE EXCEPTION 'The idempotency key was used for a different moderation action'
     USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('ok',true,'replayed',true,'auditId',v_existing.id);
 END IF;
 v_table:=CASE p_type
  WHEN 'posts' THEN 'posts'
  WHEN 'comments' THEN 'comments'
  WHEN 'discussion_messages' THEN 'discussion_messages'
  WHEN 'marketplace_items' THEN 'marketplace_items'
  WHEN 'videos' THEN 'videos'
  WHEN 'novels' THEN 'novels'
  WHEN 'content_reports' THEN 'content_reports'
  ELSE NULL END;
 IF v_table IS NULL THEN
  RAISE EXCEPTION 'Unsupported moderation content type' USING ERRCODE='22023';
 END IF;
 IF p_action='delete' AND p_type<>'content_reports' THEN
  -- This name is selected from the fixed allow-list above, not user input.
  EXECUTE format('DELETE FROM public.%I WHERE id=$1 RETURNING id',v_table)
   INTO v_changed USING p_content_id;
 ELSIF p_type='posts' AND p_action IN ('publish','unpublish') THEN
  v_status:=CASE p_action WHEN 'publish' THEN 'published' ELSE 'draft' END;
  UPDATE public.posts SET status=v_status WHERE id=p_content_id RETURNING id INTO v_changed;
 ELSIF p_type='comments' AND p_action IN ('approve','hide') THEN
  v_status:=CASE p_action WHEN 'approve' THEN 'approved' ELSE 'pending' END;
  UPDATE public.comments SET status=v_status WHERE id=p_content_id RETURNING id INTO v_changed;
 ELSIF p_type='marketplace_items' AND p_action='hide' THEN
  UPDATE public.marketplace_items SET is_available=false WHERE id=p_content_id
   RETURNING id INTO v_changed;
 ELSIF p_type='videos' AND p_action='hide' THEN
  UPDATE public.videos SET is_public=false WHERE id=p_content_id RETURNING id INTO v_changed;
 ELSIF p_type='novels' AND p_action='hide' THEN
  UPDATE public.novels SET status='paused' WHERE id=p_content_id RETURNING id INTO v_changed;
 ELSIF p_type='content_reports' AND p_action IN ('resolve','dismiss') THEN
  UPDATE public.content_reports SET status=CASE p_action WHEN 'resolve' THEN 'resolved' ELSE 'dismissed' END
   WHERE id=p_content_id AND status='open' RETURNING id INTO v_changed;
 ELSE
  RAISE EXCEPTION 'Unsupported moderation action' USING ERRCODE='22023';
 END IF;
 IF v_changed IS NULL THEN
  RAISE EXCEPTION 'Content item not found' USING ERRCODE='P0002';
 END IF;
 INSERT INTO public.moderation_audit(
  moderator_id,moderator_role,action,content_type,content_id,details,request_id
 ) VALUES(
  p_actor,v_role,p_action,p_type,p_content_id::text,
  jsonb_build_object('source','moderate-content','atomic',true),p_request_id
 ) RETURNING id INTO v_audit_id;
 RETURN jsonb_build_object('ok',true,'replayed',false,'auditId',v_audit_id);
END
$function$
;
REVOKE ALL ON FUNCTION public.moderate_content_transactional(uuid,text,text,uuid,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_content_transactional(uuid,text,text,uuid,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
