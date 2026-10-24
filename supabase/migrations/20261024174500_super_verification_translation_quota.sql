-- Super-admin-only manual badge operations with evidence-backed audit trail.
-- Business/organization verification must still pass the document-review workflow.
CREATE TABLE IF NOT EXISTS private.admin_verification_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  previous_tier text NOT NULL,
  awarded_tier text NOT NULL CHECK(awarded_tier IN ('silver','gold','platinum')),
  reason text NOT NULL CHECK(length(reason) BETWEEN 25 AND 1800),
  created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL PRIVILEGES ON TABLE private.admin_verification_audit FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS admin_verification_audit_user_idx
 ON private.admin_verification_audit(user_id,created_at DESC);
CREATE OR REPLACE FUNCTION public.admin_manage_verified_identity(
 p_actor uuid,p_user uuid,p_tier text,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public,private AS $manage$
DECLARE old_record public.profiles%ROWTYPE;actor_role text;
BEGIN
 IF current_setting('request.jwt.claim.role',true) IS DISTINCT FROM 'service_role'
 THEN RAISE EXCEPTION 'Service-only verification action' USING ERRCODE='42501'; END IF;
 SELECT role INTO actor_role FROM public.profiles WHERE id=p_actor;
 IF lower(coalesce(actor_role,'')) <> 'super'
 THEN RAISE EXCEPTION 'Super administrator required' USING ERRCODE='42501'; END IF;
 IF p_tier NOT IN ('silver','gold','platinum')
 THEN RAISE EXCEPTION 'Only Silver, Gold or Platinum can be granted here' USING ERRCODE='22023'; END IF;
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 25 AND 1800
 THEN RAISE EXCEPTION 'Detailed identity evidence and decision reason required' USING ERRCODE='22023'; END IF;
 SELECT * INTO old_record FROM public.profiles WHERE id=p_user FOR UPDATE;
 IF NOT FOUND OR old_record.account_status IS DISTINCT FROM 'active'
 THEN RAISE EXCEPTION 'Target must be an active account' USING ERRCODE='22023'; END IF;
 IF old_record.is_verified IS TRUE AND old_record.verification_tier=p_tier
 THEN RAISE EXCEPTION 'User already has this active tier' USING ERRCODE='22023'; END IF;
 UPDATE public.profiles SET is_verified=true,verification_tier=p_tier,
 verified_at=now(),verification_expires_at=now()+interval '365 days',
 frame_style=CASE WHEN old_record.is_verified THEN old_record.frame_style ELSE 'signature' END
 WHERE id=p_user;
 INSERT INTO private.admin_verification_audit(user_id,actor_id,previous_tier,awarded_tier,reason)
 VALUES(p_user,p_actor,coalesce(old_record.verification_tier,'standard'),p_tier,btrim(p_reason));
 PERFORM public.emit_user_notification(p_user,'verification_status','Verification updated',
  'Your Timzee Tech Hub verification is now '||initcap(p_tier)||'.',
  '/profile.html?id='||p_user::text,
  jsonb_build_object('tier',p_tier,'action','verified'));
 RETURN jsonb_build_object('id',p_user,'is_verified',true,'verification_tier',p_tier);
END $manage$;
REVOKE ALL ON FUNCTION public.admin_manage_verified_identity(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.admin_manage_verified_identity(uuid,uuid,text,text) TO service_role;

-- Require authentication, not paid verification, for basic translation.
-- Verified members retain 18 requests/hour; everyone else receives six.
CREATE OR REPLACE FUNCTION public.consume_verified_translation_quota(p_chars integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $quota$
DECLARE v_actor uuid:=(SELECT auth.uid());v_verified boolean:=false;
 v_tier text:='standard';v_limit integer:=6;v_window timestamptz:=date_trunc('hour',now());v_used integer;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 IF p_chars NOT BETWEEN 1 AND 3000 THEN
  RAISE EXCEPTION 'Translation must be 1-3000 characters' USING ERRCODE='22023'; END IF;
 SELECT p.is_verified IS TRUE AND (p.verification_expires_at IS NULL OR p.verification_expires_at>now()),
  p.verification_tier INTO v_verified,v_tier FROM public.profiles p WHERE p.id=v_actor;
 IF coalesce(v_verified,false) AND lower(coalesce(v_tier,'')) IN ('silver','gold','platinum','business') THEN v_limit:=18;END IF;
 INSERT INTO public.verified_translation_usage(user_id,window_start,requests,characters,updated_at)
 VALUES(v_actor,v_window,1,p_chars,now())
 ON CONFLICT(user_id,window_start)
 DO UPDATE SET requests=public.verified_translation_usage.requests+1,
  characters=public.verified_translation_usage.characters+excluded.characters,updated_at=now()
 WHERE public.verified_translation_usage.requests < v_limit
 RETURNING requests INTO v_used;
 IF v_used IS NULL THEN RAISE EXCEPTION 'Translation hourly quota reached ('||v_limit||' requests)' USING ERRCODE='P0001'; END IF;
 RETURN jsonb_build_object('remaining',v_limit-v_used,'resets_at',v_window+interval '1 hour','limit',v_limit);
END $quota$;
REVOKE ALL ON FUNCTION public.consume_verified_translation_quota(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.consume_verified_translation_quota(integer) TO authenticated;
