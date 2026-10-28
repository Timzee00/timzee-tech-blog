-- Never persist a private email as the publicly displayed video/comment author.
-- Existing legacy email bylines are normalized only when show_email is false.
CREATE OR REPLACE FUNCTION public.privacy_safe_video_author()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public AS $body$
DECLARE profile_name text;
BEGIN
 IF NEW.user_id IS NULL THEN RETURN NEW; END IF;
 IF NEW.author_name IS NULL OR NEW.author_name ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
   SELECT coalesce(nullif(p.username,''),nullif(p.display_name,''),'Member')
   INTO profile_name FROM public.public_profiles p WHERE p.id=NEW.user_id;
   IF profile_name IS NOT NULL THEN
     NEW.author_name:=CASE WHEN profile_name ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
       THEN 'Member' ELSE left(profile_name,70) END;
   ELSE NEW.author_name:='Member'; END IF;
 END IF;
 RETURN NEW;
END $body$;
DROP TRIGGER IF EXISTS privacy_safe_video_comments_author ON public.video_comments;
CREATE TRIGGER privacy_safe_video_comments_author BEFORE INSERT OR UPDATE OF author_name,user_id
 ON public.video_comments FOR EACH ROW EXECUTE FUNCTION public.privacy_safe_video_author();
DROP TRIGGER IF EXISTS privacy_safe_videos_author ON public.videos;
CREATE TRIGGER privacy_safe_videos_author BEFORE INSERT OR UPDATE OF author_name,user_id
 ON public.videos FOR EACH ROW EXECUTE FUNCTION public.privacy_safe_video_author();
UPDATE public.video_comments c SET author_name=coalesce(
 NULLIF(CASE WHEN p.username ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN '' ELSE p.username END,''),
 NULLIF(CASE WHEN p.display_name ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN '' ELSE p.display_name END,''),'Member')
FROM public.profiles p WHERE c.user_id=p.id AND p.show_email IS DISTINCT FROM true
 AND c.author_name ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
UPDATE public.videos v SET author_name=coalesce(
 NULLIF(CASE WHEN p.username ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN '' ELSE p.username END,''),
 NULLIF(CASE WHEN p.display_name ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN '' ELSE p.display_name END,''),'Member')
FROM public.profiles p WHERE v.user_id=p.id AND p.show_email IS DISTINCT FROM true
 AND v.author_name ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$';
