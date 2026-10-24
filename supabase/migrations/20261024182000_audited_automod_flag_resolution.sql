
-- Audited human decisions for automated safety flags. A classifier or mass-report
-- threshold is never treated as proof of wrongdoing or grounds for account bans.
CREATE OR REPLACE FUNCTION public.staff_review_automated_flag(
 p_actor uuid,p_flag bigint,p_decision text,p_reason text,p_request uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $flagreview$
DECLARE v_role text;v_flag public.moderation_automated_flags%ROWTYPE;v_audit bigint;v_owner uuid;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'Server-only review' USING ERRCODE='42501';END IF;
 IF p_actor IS NULL OR p_flag IS NULL OR p_request IS NULL
    OR p_decision NOT IN ('approve','hide','dismiss')
    OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 20 AND 2000
 THEN RAISE EXCEPTION 'A documented review decision is required' USING ERRCODE='22023';END IF;
 SELECT lower(coalesce(role,'user')) INTO v_role FROM public.profiles
  WHERE id=p_actor AND account_status='active' FOR SHARE;
 IF v_role NOT IN ('moderator','admin','super') THEN
  RAISE EXCEPTION 'Moderator authorization required' USING ERRCODE='42501';END IF;
 SELECT * INTO v_flag FROM public.moderation_automated_flags WHERE id=p_flag FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Flag not found' USING ERRCODE='P0002';END IF;
 SELECT id INTO v_audit FROM public.moderation_audit WHERE request_id=p_request;
 IF FOUND THEN
  IF NOT EXISTS(SELECT 1 FROM public.moderation_audit
     WHERE id=v_audit AND moderator_id=p_actor
       AND content_type='moderation_automated_flags'
       AND content_id=p_flag::text AND action='automod_'||p_decision) THEN
   RAISE EXCEPTION 'Request ID already belongs to a different operation' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('ok',true,'replayed',true,'auditId',v_audit);
 END IF;
 IF v_flag.state<>'pending' THEN
  RAISE EXCEPTION 'Flag already reviewed' USING ERRCODE='23505';END IF;
 IF v_flag.target_type IN ('comment','comments') THEN
  SELECT author_id INTO v_owner FROM public.comments WHERE id=v_flag.target_id;
  IF p_decision='hide' THEN
   UPDATE public.comments SET status='pending',
     moderation_reason='Moderation review: content requires correction' WHERE id=v_flag.target_id;
  ELSE
   UPDATE public.comments SET status='approved',moderation_reason=NULL
    WHERE id=v_flag.target_id AND status='pending'
      AND moderation_reason='Temporarily held for automated safety review';
  END IF;
 ELSIF v_flag.target_type IN ('post','posts') AND p_decision='hide' THEN
  UPDATE public.posts SET status='draft' WHERE id=v_flag.target_id;
  SELECT author_id INTO v_owner FROM public.posts WHERE id=v_flag.target_id;
 ELSIF v_flag.target_type='discussion_message' AND p_decision='hide' THEN
  UPDATE public.discussion_messages SET moderation_status='pending' WHERE id=v_flag.target_id;
  SELECT author_id INTO v_owner FROM public.discussion_messages WHERE id=v_flag.target_id;
 ELSIF v_flag.target_type='marketplace_item' AND p_decision='hide' THEN
  UPDATE public.marketplace_items SET is_available=false WHERE id=v_flag.target_id;
  SELECT user_id INTO v_owner FROM public.marketplace_items WHERE id=v_flag.target_id;
 ELSIF v_flag.target_type='video' AND p_decision='hide' THEN
  UPDATE public.videos SET is_public=false WHERE id=v_flag.target_id;
  SELECT user_id INTO v_owner FROM public.videos WHERE id=v_flag.target_id;
 ELSIF p_decision='hide' THEN
  RAISE EXCEPTION 'This content category cannot be hidden from this review' USING ERRCODE='22023';
 END IF;
 UPDATE public.moderation_automated_flags SET
  state=CASE WHEN p_decision='dismiss' THEN 'dismissed' ELSE 'reviewed' END,updated_at=now()
 WHERE id=p_flag;
 INSERT INTO public.moderation_audit
   (moderator_id,moderator_role,action,content_type,content_id,details,request_id)
 VALUES(p_actor,v_role,'automod_'||p_decision,'moderation_automated_flags',p_flag::text,
  jsonb_build_object('flag_type',v_flag.target_type,'target_id',v_flag.target_id,
   'risk_score',v_flag.risk_score,'signals',v_flag.signals,'reason',btrim(p_reason)),p_request)
 RETURNING id INTO v_audit;
 IF p_decision='hide' AND v_owner IS NOT NULL THEN
  PERFORM public.emit_user_notification(v_owner,'moderation_review',
   'Your content was held for review',
   'A moderator reviewed a report and temporarily hid an item. Contact support if you believe this was incorrect.',
   '/support.html',jsonb_build_object('flag_id',p_flag,'action',p_decision));
 END IF;
 RETURN jsonb_build_object('ok',true,'replayed',false,'auditId',v_audit);
END $flagreview$;
REVOKE ALL ON FUNCTION public.staff_review_automated_flag(uuid,bigint,text,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_review_automated_flag(uuid,bigint,text,text,uuid) TO service_role;
NOTIFY pgrst,'reload schema';
