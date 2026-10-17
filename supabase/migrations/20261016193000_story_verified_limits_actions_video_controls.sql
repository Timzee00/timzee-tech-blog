
-- Verified expiry, creator controls and privacy-scoped status activity.
ALTER TABLE public.stories
 ADD COLUMN IF NOT EXISTS allow_reshare boolean NOT NULL DEFAULT true,
 ADD COLUMN IF NOT EXISTS allow_public_comments boolean NOT NULL DEFAULT true,
 ADD COLUMN IF NOT EXISTS original_story_id uuid REFERENCES public.stories(id) ON DELETE SET NULL;
ALTER TABLE public.videos
 ADD COLUMN IF NOT EXISTS allow_comments boolean NOT NULL DEFAULT true,
 ADD COLUMN IF NOT EXISTS allow_download boolean NOT NULL DEFAULT true;
CREATE OR REPLACE FUNCTION public.limit_story_expiration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_verified boolean := false; v_max timestamptz;
BEGIN
 IF NEW.user_id IS DISTINCT FROM (select auth.uid()) AND current_user <> 'service_role' THEN
  RAISE EXCEPTION 'Story owner mismatch' USING ERRCODE='42501';
 END IF;
 SELECT coalesce(p.is_verified,false) INTO v_verified FROM public.profiles p WHERE p.id=NEW.user_id;
 v_max:=NEW.created_at + CASE WHEN v_verified THEN interval '72 hours' ELSE interval '24 hours' END;
 IF NEW.expires_at IS NULL THEN NEW.expires_at:=NEW.created_at+interval '24 hours'; END IF;
 IF NEW.expires_at>v_max OR NEW.expires_at<=NEW.created_at THEN
  RAISE EXCEPTION 'Status expiry exceeds your account limit' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS story_expiration_policy ON public.stories;
CREATE TRIGGER story_expiration_policy BEFORE INSERT OR UPDATE OF expires_at,user_id
 ON public.stories FOR EACH ROW EXECUTE FUNCTION public.limit_story_expiration();

CREATE OR REPLACE FUNCTION public.enforce_video_comment_settings()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM public.videos v WHERE v.id=NEW.video_id
    AND v.allow_comments=true AND (v.is_public=true OR v.user_id=auth.uid())) THEN
  RAISE EXCEPTION 'The creator has turned off comments on this video' USING ERRCODE='42501';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS video_comment_settings_guard ON public.video_comments;
CREATE TRIGGER video_comment_settings_guard BEFORE INSERT ON public.video_comments
 FOR EACH ROW EXECUTE FUNCTION public.enforce_video_comment_settings();

CREATE TABLE IF NOT EXISTS public.story_likes(
 story_id uuid NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(story_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.story_saves(
 story_id uuid NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(story_id,user_id)
);
CREATE TABLE IF NOT EXISTS public.story_comments(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 story_id uuid NOT NULL REFERENCES public.stories(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 600),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS story_comments_recent_idx ON public.story_comments(story_id,created_at DESC);
CREATE INDEX IF NOT EXISTS story_saves_user_idx ON public.story_saves(user_id,created_at DESC);
CREATE INDEX IF NOT EXISTS story_likes_user_idx ON public.story_likes(user_id,created_at DESC);
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['story_likes','story_saves','story_comments'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON public.%I FROM anon,authenticated',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT,DELETE ON public.story_likes,public.story_saves TO authenticated;
GRANT SELECT,INSERT,DELETE ON public.story_comments TO authenticated;
DROP POLICY IF EXISTS "Status likes viewable when visible" ON public.story_likes;
CREATE POLICY "Status likes viewable when visible" ON public.story_likes FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.stories s WHERE s.id=story_id));
DROP POLICY IF EXISTS "Like visible status" ON public.story_likes;
CREATE POLICY "Like visible status" ON public.story_likes FOR INSERT TO authenticated
 WITH CHECK(user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.stories s WHERE s.id=story_id));
DROP POLICY IF EXISTS "Unlike own status like" ON public.story_likes;
CREATE POLICY "Unlike own status like" ON public.story_likes FOR DELETE TO authenticated USING(user_id=auth.uid());

DROP POLICY IF EXISTS "View own status saves" ON public.story_saves;
CREATE POLICY "View own status saves" ON public.story_saves FOR SELECT TO authenticated USING(user_id=auth.uid());
DROP POLICY IF EXISTS "Save visible status" ON public.story_saves;
CREATE POLICY "Save visible status" ON public.story_saves FOR INSERT TO authenticated
 WITH CHECK(user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.stories s WHERE s.id=story_id));
DROP POLICY IF EXISTS "Remove own saved status" ON public.story_saves;
CREATE POLICY "Remove own saved status" ON public.story_saves FOR DELETE TO authenticated USING(user_id=auth.uid());

DROP POLICY IF EXISTS "Status comments visible to audience" ON public.story_comments;
CREATE POLICY "Status comments visible to audience" ON public.story_comments FOR SELECT TO authenticated
 USING(EXISTS(SELECT 1 FROM public.stories s WHERE s.id=story_id AND s.allow_public_comments));
DROP POLICY IF EXISTS "Comment on visible status" ON public.story_comments;
CREATE POLICY "Comment on visible status" ON public.story_comments FOR INSERT TO authenticated
 WITH CHECK(user_id=auth.uid() AND EXISTS(SELECT 1 FROM public.stories s WHERE s.id=story_id AND s.allow_public_comments));
DROP POLICY IF EXISTS "Remove own status comment" ON public.story_comments;
CREATE POLICY "Remove own status comment" ON public.story_comments FOR DELETE TO authenticated USING(user_id=auth.uid());
-- Reshare server-side so clients cannot invent an origin or bypass visibility.
CREATE OR REPLACE FUNCTION public.reshare_status(p_story_id uuid,p_caption text DEFAULT NULL)
RETURNS public.stories LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_actor uuid:=auth.uid(); v_origin public.stories%ROWTYPE; v_new public.stories%ROWTYPE;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Sign in to reshare' USING ERRCODE='42501'; END IF;
 SELECT s.* INTO v_origin FROM public.stories s WHERE s.id=p_story_id AND s.expires_at>now();
 IF NOT FOUND OR NOT v_origin.allow_reshare OR
   NOT(v_origin.visibility='public' OR v_origin.user_id=v_actor OR EXISTS (
    SELECT 1 FROM public.friendships f WHERE f.status='accepted'
     AND ((f.requester_id=v_actor AND f.addressee_id=v_origin.user_id)
       OR(f.addressee_id=v_actor AND f.requester_id=v_origin.user_id)))) THEN
   RAISE EXCEPTION 'This story cannot be reshared' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.stories(user_id,media_url,media_type,caption,visibility,
   created_at,expires_at,original_story_id,allow_reshare)
 VALUES(v_actor,v_origin.media_url,v_origin.media_type,left(coalesce(p_caption,v_origin.caption,''),200),'public',
   now(),now()+interval '24 hours',p_story_id,false)
 RETURNING * INTO v_new;
 RETURN v_new;
END $$;
REVOKE ALL ON FUNCTION public.reshare_status(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.reshare_status(uuid,text) TO authenticated;
