-- Verification applications are triaged automatically, but only a
-- correctly authorized staff review can grant authentic verification.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS verification_expires_at timestamptz;
ALTER TABLE public.public_profiles ADD COLUMN IF NOT EXISTS verification_expires_at timestamptz;
ALTER TABLE public.verification_applications
 ADD COLUMN IF NOT EXISTS triage_flags text[] NOT NULL DEFAULT '{}',
 ADD COLUMN IF NOT EXISTS triage_score integer NOT NULL DEFAULT 0
  CHECK(triage_score BETWEEN 0 AND 100);
CREATE OR REPLACE FUNCTION private.sync_public_profile()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  if tg_op = 'DELETE' then
    delete from public.public_profiles where id = old.id;
    return old;
  end if;

  insert into public.public_profiles (
    id, display_name, bio, avatar_url, role, created_at, updated_at,
    is_verified, verification_tier, verified_at, username, email,
    cover_url, headline, location, website, allow_messages,
    allow_requests, show_email, points, level, is_featured,
    is_staff_pick, marketplace_whatsapp, frame_style, verification_expires_at
  )
  values (
    new.id, new.display_name, new.bio, new.avatar_url, new.role,
    new.created_at, new.updated_at, new.is_verified, new.verification_tier,
    new.verified_at, new.username,
    case when coalesce(new.show_email, false) then new.email else null end,
    new.cover_url, new.headline, new.location, new.website,
    new.allow_messages, new.allow_requests, new.show_email, new.points,
    new.level, new.is_featured, new.is_staff_pick, new.marketplace_whatsapp, new.frame_style,
    new.verification_expires_at
  )
  on conflict (id) do update set
    display_name = excluded.display_name,
    bio = excluded.bio,
    avatar_url = excluded.avatar_url,
    role = excluded.role,
    created_at = excluded.created_at,
    updated_at = excluded.updated_at,
    is_verified = excluded.is_verified,
    verification_tier = excluded.verification_tier,
    verified_at = excluded.verified_at,
    username = excluded.username,
    email = excluded.email,
    cover_url = excluded.cover_url,
    headline = excluded.headline,
    location = excluded.location,
    website = excluded.website,
    allow_messages = excluded.allow_messages,
    allow_requests = excluded.allow_requests,
    show_email = excluded.show_email,
    points = excluded.points,
    level = excluded.level,
    is_featured = excluded.is_featured,
    is_staff_pick = excluded.is_staff_pick,
    marketplace_whatsapp = excluded.marketplace_whatsapp,
    frame_style = excluded.frame_style,
    verification_expires_at = excluded.verification_expires_at;

  return new;
end;
$function$
;
CREATE OR REPLACE FUNCTION public.protect_profile_privileged_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
begin
  -- Backend/service-role writes have no auth.uid() and are allowed to perform
  -- moderation/account-management changes. Normal signed-in users may only
  -- create/update their own presentation and preference fields.
  if (select auth.uid()) is not null then
    if tg_op = 'INSERT' then
      if new.id is distinct from (select auth.uid()) then
        raise exception 'Profile identity cannot be changed';
      end if;
      if lower(coalesce(new.role, 'user')) <> 'user'
         or coalesce(new.is_verified, false)
         or lower(coalesce(new.verification_tier, 'standard')) <> 'standard'
         or lower(coalesce(new.account_status, 'active')) <> 'active'
         or coalesce(new.verified_at, null) is not null
         or new.verification_expires_at is not null
         or coalesce(new.points, 0) <> 0
         or coalesce(new.is_featured, false)
         or coalesce(new.is_staff_pick, false) then
        raise exception 'Protected profile fields can only be initialized by the server';
      end if;
    else
      if new.id is distinct from old.id then
        raise exception 'Profile identity cannot be changed';
      end if;
      if new.role is distinct from old.role
         or new.is_verified is distinct from old.is_verified
         or new.verification_tier is distinct from old.verification_tier
         or new.account_status is distinct from old.account_status
         or new.verified_at is distinct from old.verified_at
         or new.verification_expires_at is distinct from old.verification_expires_at
         or new.points is distinct from old.points
         or new.level is distinct from old.level
         or new.is_featured is distinct from old.is_featured
         or new.is_staff_pick is distinct from old.is_staff_pick
         or new.created_at is distinct from old.created_at then
        raise exception 'Protected profile fields can only be changed by the server';
      end if;
    end if;
  end if;
  return new;
end;
$function$
;
CREATE TABLE IF NOT EXISTS public.verification_review_audit(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 application_id uuid NOT NULL REFERENCES public.verification_applications(id) ON DELETE RESTRICT,
 reviewed_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 reviewed_by uuid NOT NULL REFERENCES auth.users(id),
 decision text NOT NULL CHECK(decision IN ('approved','rejected')),
 approved_level text CHECK(approved_level IS NULL OR approved_level IN ('silver','gold','platinum','business')),
 review_note text NOT NULL CHECK(length(review_note) BETWEEN 25 AND 1800),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_review_user_audit ON public.verification_review_audit(reviewed_user_id,created_at DESC);
ALTER TABLE public.verification_review_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verification_review_audit FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.verification_review_audit TO authenticated;
CREATE POLICY verification_review_staff_read ON public.verification_review_audit
 FOR SELECT TO authenticated USING(coalesce(public.has_role_secure('admin'),false)
 OR coalesce(public.has_role_secure('super'),false));

CREATE OR REPLACE FUNCTION public.triage_verification_application()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE flags text[]:=ARRAY[]::text[];risk integer:=0;age interval;
BEGIN
 IF coalesce(jsonb_array_length(new.documents),0)=0 THEN
    flags:=array_append(flags,'no_identity_evidence');risk:=risk+45;
 END IF;
 IF new.verification_type='business' THEN
   IF coalesce(new.message,'') !~* 'https://[a-z0-9.-]+\.[a-z]{2,}' THEN
     flags:=array_append(flags,'organization_website_unconfirmed');risk:=risk+35;
   END IF;
   flags:=array_append(flags,'organization_authorization_review_required');
 END IF;
 SELECT now()-u.created_at INTO age FROM auth.users u WHERE u.id=new.user_id;
 IF age<interval '7 days' THEN
  flags:=array_append(flags,'new_account');risk:=risk+15;
 END IF;
 UPDATE public.verification_applications SET triage_flags=flags,
  triage_score=least(100,risk) WHERE id=new.id;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS verification_application_auto_triage ON public.verification_applications;
CREATE TRIGGER verification_application_auto_triage AFTER INSERT
 ON public.verification_applications FOR EACH ROW
 EXECUTE FUNCTION public.triage_verification_application();
REVOKE ALL ON FUNCTION public.triage_verification_application() FROM PUBLIC,anon,authenticated;

-- This function is deliberately service-role-only; admin identity is validated
-- independently by the Netlify endpoint and checked again here.
CREATE OR REPLACE FUNCTION public.review_verification_application(
 p_application uuid,p_reviewer uuid,p_decision text,p_level text,p_note text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
     left(p_note,1000));
 END IF;
 UPDATE public.verification_applications SET status=p_decision,reviewed_by=p_reviewer,
 reviewed_at=now() WHERE id=p_application;
 INSERT INTO public.verification_review_audit(application_id,reviewed_user_id,reviewed_by,
   decision,approved_level,review_note)
 VALUES(p_application,application.user_id,p_reviewer,p_decision,
   CASE WHEN p_decision='approved' THEN p_level ELSE NULL END,btrim(p_note));
 RETURN jsonb_build_object('application_id',p_application,'decision',p_decision,
   'level',CASE WHEN p_decision='approved' THEN p_level ELSE NULL END);
END $$;
REVOKE ALL ON FUNCTION public.review_verification_application(uuid,uuid,text,text,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.review_verification_application(uuid,uuid,text,text,text) TO service_role;

CREATE TABLE IF NOT EXISTS public.verification_maintenance_notices(
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 notice text NOT NULL CHECK(notice IN ('expiring_14d','expiring_3d','expired')),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,notice,expires_at)
);
ALTER TABLE public.verification_maintenance_notices ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verification_maintenance_notices FROM PUBLIC,anon,authenticated;
CREATE INDEX IF NOT EXISTS verification_expiring_profiles_idx
 ON public.profiles(verification_expires_at)
 WHERE is_verified=true AND verification_expires_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.process_verification_maintenance()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE record public.profiles%ROWTYPE;v_notice text;v_notice_added boolean;
 expire_count integer:=0;reminder_count integer:=0;visits_deleted integer:=0;
BEGIN
 FOR record IN SELECT * FROM public.profiles p WHERE p.is_verified=true
  AND p.verification_expires_at IS NOT NULL
  AND p.verification_expires_at<=now() ORDER BY p.verification_expires_at LIMIT 100
 FOR UPDATE SKIP LOCKED LOOP
  UPDATE public.profiles SET is_verified=false,verification_tier='standard',
    verified_at=NULL,verification_expires_at=NULL,frame_style='signature'
   WHERE id=record.id AND is_verified=true;
  PERFORM public.emit_user_notification(record.id,'verification_status',
    'Verification expired','Your verified badge has expired. Please apply to renew it.',
    '/verify.html',jsonb_build_object('event','expired'));
  expire_count:=expire_count+1;
 END LOOP;
 FOR record IN SELECT * FROM public.profiles p WHERE p.is_verified=true
  AND p.verification_expires_at>now()
  AND p.verification_expires_at<=now()+interval '14 days'
  ORDER BY p.verification_expires_at LIMIT 100 LOOP
  v_notice:=CASE WHEN record.verification_expires_at<=now()+interval '3 days'
      THEN 'expiring_3d' ELSE 'expiring_14d' END;
  INSERT INTO public.verification_maintenance_notices(user_id,notice,expires_at)
    VALUES(record.id,v_notice,record.verification_expires_at)
    ON CONFLICT DO NOTHING RETURNING true INTO v_notice_added;
  IF coalesce(v_notice_added,false) THEN
    PERFORM public.emit_user_notification(record.id,'verification_status',
      'Verification renewal reminder',
      'Your verification is nearing expiry. Prepare a renewal application.',
      '/verify.html',jsonb_build_object('event',v_notice));
    reminder_count:=reminder_count+1;
  END IF;
  v_notice_added:=false;
 END LOOP;
 visits_deleted:=public.cleanup_profile_visit_events();
 RETURN jsonb_build_object('expired',expire_count,'reminders',reminder_count,
    'removed_old_profile_visits',visits_deleted);
END $$;
REVOKE ALL ON FUNCTION public.process_verification_maintenance() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.process_verification_maintenance() TO service_role;
UPDATE public.public_profiles pp SET verification_expires_at=p.verification_expires_at
FROM public.profiles p WHERE pp.id=p.id;
