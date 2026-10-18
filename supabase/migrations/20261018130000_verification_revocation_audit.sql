-- Revocation must be reasoned, auditable and atomic. Tier grants are made
-- exclusively by the staff review workflow, not by the legacy user toolbar.
CREATE TABLE IF NOT EXISTS public.verification_status_events(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 action text NOT NULL CHECK(action IN ('revoked')),
 previous_level text NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 25 AND 1800),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS verification_status_events_user_idx
 ON public.verification_status_events(user_id,created_at DESC);
ALTER TABLE public.verification_status_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verification_status_events FROM PUBLIC,anon,authenticated;
GRANT SELECT ON public.verification_status_events TO authenticated;
CREATE POLICY verification_status_events_admin_read ON public.verification_status_events
 FOR SELECT TO authenticated USING(coalesce(public.has_role_secure('admin'),false)
 OR coalesce(public.has_role_secure('super'),false));

CREATE OR REPLACE FUNCTION public.revoke_verified_identity(
 p_user uuid,p_actor uuid,p_reason text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_level text;actor_role text;target_role text;
BEGIN
 SELECT lower(coalesce(role,'user')) INTO actor_role FROM public.profiles WHERE id=p_actor;
 SELECT lower(coalesce(role,'user')),verification_tier INTO target_role,old_level
 FROM public.profiles WHERE id=p_user FOR UPDATE;
 IF actor_role NOT IN ('admin','super') OR old_level IS NULL THEN
   RAISE EXCEPTION 'Administrator authorization required' USING ERRCODE='42501';
 END IF;
 IF target_role IN ('super','admin') AND actor_role<>'super' THEN
   RAISE EXCEPTION 'Super administrator approval required' USING ERRCODE='42501';
 END IF;
 IF length(btrim(coalesce(p_reason,''))) NOT BETWEEN 25 AND 1800 THEN
   RAISE EXCEPTION 'A documented revocation reason is required' USING ERRCODE='22023';
 END IF;
 UPDATE public.profiles SET is_verified=false,verification_tier='standard',
 verified_at=NULL,verification_expires_at=NULL,frame_style='signature'
 WHERE id=p_user AND is_verified=true;
 IF NOT FOUND THEN RAISE EXCEPTION 'Account has no active verification'; END IF;
 INSERT INTO public.verification_status_events(user_id,actor_id,action,previous_level,reason)
 VALUES(p_user,p_actor,'revoked',old_level,btrim(p_reason));
 PERFORM public.emit_user_notification(p_user,'verification_status',
  'Verification status removed','Your verification has been removed. Contact support if you believe this is a mistake.',
  '/verify.html',jsonb_build_object('action','revoked'));
 RETURN jsonb_build_object('id',p_user,'status','revoked');
END $$;
REVOKE ALL ON FUNCTION public.revoke_verified_identity(uuid,uuid,text) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_verified_identity(uuid,uuid,text) TO service_role;
