-- Global per-user quota, independent of Netlify instance memory.
CREATE TABLE IF NOT EXISTS public.verified_translation_usage (
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 window_start timestamptz NOT NULL,
 requests integer NOT NULL DEFAULT 0 CHECK(requests BETWEEN 0 AND 18),
 characters integer NOT NULL DEFAULT 0 CHECK(characters>=0),
 updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,window_start)
);
CREATE INDEX IF NOT EXISTS verified_translation_window_idx
ON public.verified_translation_usage(window_start);
ALTER TABLE public.verified_translation_usage ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verified_translation_usage FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.consume_verified_translation_quota(p_chars integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE
 v_actor uuid:=auth.uid();
 v_verified boolean:=false;
 v_window timestamptz:=date_trunc('hour',now());
 v_used integer;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Authentication required'
 USING ERRCODE='42501'; END IF;
 IF p_chars NOT BETWEEN 1 AND 3000 THEN
  RAISE EXCEPTION 'Translation must be 1–3000 characters'
  USING ERRCODE='22023'; END IF;
 SELECT coalesce(p.is_verified,false) INTO v_verified
 FROM public.profiles p WHERE p.id=v_actor;
 IF NOT v_verified THEN RAISE EXCEPTION 'Verification required for translation'
 USING ERRCODE='42501'; END IF;
 INSERT INTO public.verified_translation_usage
 (user_id,window_start,requests,characters,updated_at)
 VALUES(v_actor,v_window,1,p_chars,now())
 ON CONFLICT(user_id,window_start)
 DO UPDATE SET requests=public.verified_translation_usage.requests+1,
 characters=public.verified_translation_usage.characters+excluded.characters,
 updated_at=now()
 WHERE public.verified_translation_usage.requests<18
 RETURNING requests INTO v_used;
 IF v_used IS NULL THEN
  RAISE EXCEPTION 'Translation hourly quota reached (18 requests)' USING ERRCODE='P0001';
 END IF;
 RETURN jsonb_build_object(
  'remaining',18-v_used,
  'resets_at',v_window+interval '1 hour'
 );
END $$;
REVOKE ALL ON FUNCTION public.consume_verified_translation_quota(integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.consume_verified_translation_quota(integer) TO authenticated;
