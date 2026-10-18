-- Discord-inspired but entirely original Timzee collectibles.
-- Keep the canonical tier and approval fields unchanged; frame cosmetics
-- must never grant verification, staff roles, reach, or moderation privileges.
ALTER TABLE public.profiles
 DROP CONSTRAINT IF EXISTS profiles_frame_style_allowed;
ALTER TABLE public.profiles
 ADD CONSTRAINT profiles_frame_style_allowed
 CHECK (frame_style IN ('signature','library','aurora','orbit','laurel','comet'));

CREATE OR REPLACE FUNCTION public.guard_verified_frame_style()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = 'pg_catalog', 'public'
AS $function$
BEGIN
  -- Revoke decorations automatically whenever verification is removed.
  IF NOT coalesce(NEW.is_verified,false) THEN
    NEW.frame_style := 'signature';
  END IF;
  IF NEW.frame_style NOT IN ('signature','library','aurora','orbit','laurel','comet') THEN
    RAISE EXCEPTION 'Unknown portrait frame' USING ERRCODE='22023';
  END IF;
  RETURN NEW;
END
$function$;

REVOKE EXECUTE ON FUNCTION public.guard_verified_frame_style()
  FROM PUBLIC, anon, authenticated;
COMMENT ON COLUMN public.profiles.frame_style IS
  'Optional, server-validated presentation style. Verification tier controls its palette; no security entitlement is inferred from this column.';
