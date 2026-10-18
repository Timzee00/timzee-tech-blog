CREATE OR REPLACE FUNCTION public.review_verification_application(p_application uuid, p_reviewer uuid, p_decision text, p_level text, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE application public.verification_applications%ROWTYPE;
 reviewer_role text;doc jsonb;file_path text;v_until timestamptz;
BEGIN
 SELECT lower(coalesce(p.role,'')) INTO reviewer_role FROM public.profiles p WHERE p.id=p_reviewer;
 IF reviewer_role NOT IN ('admin','super') AND NOT EXISTS(
  SELECT 1 FROM public.user_roles r WHERE r.user_id=p_reviewer AND r.role IN ('admin','super')) THEN
  RAISE EXCEPTION 'Authorized administrator required' USING ERRCODE='42501';
 END IF;
 IF p_decision NOT IN ('approved','rejected') OR length(btrim(coalesce(p_note,''))) NOT BETWEEN 25 AND 1800 THEN
   RAISE EXCEPTION 'Provide an approval/rejection decision and a detailed audit note' USING ERRCODE='22023';
 END IF;
 SELECT * INTO application FROM public.verification_applications WHERE id=p_application FOR UPDATE;
 IF NOT FOUND OR application.status<>'pending' THEN
   RAISE EXCEPTION 'The application is missing or already reviewed' USING ERRCODE='22023';
 END IF;
 IF p_decision='approved' THEN
   IF p_level NOT IN ('silver','gold','platinum','business') THEN
     RAISE EXCEPTION 'Choose a valid verification level' USING ERRCODE='22023';
   END IF;
   IF p_level='business' AND (application.verification_type<>'business'
     OR reviewer_role<>'super') THEN
     RAISE EXCEPTION 'Official organizations require a business application and super-admin review' USING ERRCODE='42501';
   END IF;
   IF p_level<>'business' AND application.verification_type='business' THEN
     RAISE EXCEPTION 'Business identity requires organization review' USING ERRCODE='22023';
   END IF;
   IF jsonb_typeof(application.documents)<>'array'
     OR jsonb_array_length(application.documents)<1 THEN
     RAISE EXCEPTION 'Reviewable identity evidence is required before approval' USING ERRCODE='42501';
   END IF;
   FOR doc IN SELECT value FROM jsonb_array_elements(application.documents) LOOP
     file_path:=doc->>'path';
     IF file_path IS NULL OR NOT EXISTS(
       SELECT 1 FROM storage.objects o WHERE o.bucket_id='verification-proofs' AND o.name=file_path) THEN
       RAISE EXCEPTION 'Some verification documents are missing from private storage' USING ERRCODE='42501';
     END IF;
   END LOOP;
   v_until:=now()+interval '365 days';
   UPDATE public.profiles SET is_verified=true,verified_at=now(),
     verification_tier=p_level,verification_expires_at=v_until,
     frame_style='signature' WHERE id=application.user_id;
   IF NOT FOUND THEN RAISE EXCEPTION 'Applicant profile is missing'; END IF;
   INSERT INTO public.verification_badges(id,user_id,verification_level,verified_by,verified_at,expires_at,reason)
   VALUES(gen_random_uuid(),application.user_id,p_level,p_reviewer,now(),v_until,
     'Verified after evidence review');
 END IF;
 UPDATE public.verification_applications SET status=p_decision,reviewed_by=p_reviewer,
 reviewed_at=now() WHERE id=p_application;
 INSERT INTO public.verification_review_audit(application_id,reviewed_user_id,reviewed_by,
   decision,approved_level,review_note)
 VALUES(p_application,application.user_id,p_reviewer,p_decision,
   CASE WHEN p_decision='approved' THEN p_level ELSE NULL END,btrim(p_note));
 RETURN jsonb_build_object('application_id',p_application,'decision',p_decision,
   'level',CASE WHEN p_decision='approved' THEN p_level ELSE NULL END);
END $function$
;
-- Detailed staff review notes remain private in verification_review_audit,
-- never in the publicly readable historical badge table.
