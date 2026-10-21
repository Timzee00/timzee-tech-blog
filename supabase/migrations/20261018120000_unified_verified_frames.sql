-- Unified trusted creator tiers and user-selected, tier-locked portrait styles.
-- Unverified users cannot create or retain any verified frame entitlement.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS frame_style text NOT NULL DEFAULT 'signature';
ALTER TABLE public.public_profiles ADD COLUMN IF NOT EXISTS frame_style text NOT NULL DEFAULT 'signature';
UPDATE public.profiles SET verification_tier=CASE
  WHEN NOT coalesce(is_verified,false) THEN 'standard'
  WHEN verification_tier='pro' THEN 'gold'
  WHEN verification_tier='elite' THEN 'platinum'
  WHEN verification_tier IN ('gold','platinum','business') THEN verification_tier
  ELSE 'silver' END
WHERE verification_tier IS DISTINCT FROM
 CASE WHEN NOT coalesce(is_verified,false) THEN 'standard'
 WHEN verification_tier='pro' THEN 'gold'
 WHEN verification_tier='elite' THEN 'platinum'
 WHEN verification_tier IN ('gold','platinum','business') THEN verification_tier
 ELSE 'silver' END;
ALTER TABLE public.profiles
 ADD CONSTRAINT profiles_verification_level_allowed
 CHECK (verification_tier IN ('standard','silver','gold','platinum','business'));
ALTER TABLE public.profiles
 ADD CONSTRAINT profiles_frame_style_allowed
 CHECK (frame_style IN ('signature','library','aurora'));
ALTER TABLE public.profiles
 ADD CONSTRAINT profiles_tier_verified_consistency
 CHECK ((coalesce(is_verified,false) AND verification_tier<>'standard')
 OR (NOT coalesce(is_verified,false) AND verification_tier='standard'));
CREATE OR REPLACE FUNCTION public.guard_verified_frame_style()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT coalesce(new.is_verified,false) THEN
   new.frame_style:='signature';
 END IF;
 IF new.frame_style NOT IN ('signature','library','aurora') THEN
   RAISE EXCEPTION 'Unknown portrait frame' USING ERRCODE='22023';
 END IF;
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS guard_verified_frame_style_trg ON public.profiles;
CREATE TRIGGER guard_verified_frame_style_trg BEFORE INSERT OR UPDATE ON public.profiles
 FOR EACH ROW EXECUTE FUNCTION public.guard_verified_frame_style();
REVOKE ALL ON FUNCTION public.guard_verified_frame_style() FROM PUBLIC,anon,authenticated;
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
    is_staff_pick, marketplace_whatsapp, frame_style
  )
  values (
    new.id, new.display_name, new.bio, new.avatar_url, new.role,
    new.created_at, new.updated_at, new.is_verified, new.verification_tier,
    new.verified_at, new.username,
    case when coalesce(new.show_email, false) then new.email else null end,
    new.cover_url, new.headline, new.location, new.website,
    new.allow_messages, new.allow_requests, new.show_email, new.points,
    new.level, new.is_featured, new.is_staff_pick, new.marketplace_whatsapp, new.frame_style
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
    frame_style = excluded.frame_style;

  return new;
end;
$function$
;
-- Repair the materialized public directory for current members without exposing private data.
UPDATE public.public_profiles pp SET frame_style=p.frame_style,verification_tier=p.verification_tier,
 is_verified=p.is_verified
FROM public.profiles p WHERE pp.id=p.id;
