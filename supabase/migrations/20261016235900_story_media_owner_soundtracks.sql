-- Story uploads must be namespaced to the authenticated user.
DROP POLICY IF EXISTS auth_upload_stories ON storage.objects;
CREATE POLICY auth_upload_stories ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id='media'
  AND (storage.foldername(name))[1]='stories'
  AND (storage.foldername(name))[2]=(SELECT auth.uid())::text
);

-- Rights-aware audio soundtrack separate from video/image assets.
ALTER TABLE public.stories
  ADD COLUMN IF NOT EXISTS music_url text,
  ADD COLUMN IF NOT EXISTS music_title text,
  ADD COLUMN IF NOT EXISTS music_rights_confirmed boolean NOT NULL DEFAULT false;

ALTER TABLE public.stories DROP CONSTRAINT IF EXISTS story_music_rights_required;
ALTER TABLE public.stories ADD CONSTRAINT story_music_rights_required CHECK (
  music_url IS NULL OR (
    music_rights_confirmed IS TRUE AND
    music_title IS NOT NULL AND
    length(btrim(music_title)) BETWEEN 1 AND 90
  )
);

CREATE OR REPLACE FUNCTION public.validate_story_music()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public AS $$
DECLARE
 v_expected text;
BEGIN
 IF new.music_url IS NULL THEN
   new.music_title=NULL;
   new.music_rights_confirmed=false;
   RETURN new;
 END IF;
 v_expected='https://duvbcwwprkzzyzikmcol.supabase.co/storage/v1/object/public/media/stories/' || new.user_id::text || '/';
 IF new.music_url NOT LIKE v_expected || '%'
   OR length(new.music_url)>1200
   OR new.music_url ~ '[?#]'
   OR NOT new.music_url ~* '\.(mp3|m4a|ogg|webm)$'
 THEN
   RAISE EXCEPTION 'Choose an audio file uploaded to your own story folder'
     USING ERRCODE='22023';
 END IF;
 IF new.music_rights_confirmed IS DISTINCT FROM TRUE THEN
   RAISE EXCEPTION 'Music publishing rights must be confirmed'
     USING ERRCODE='22023';
 END IF;
 RETURN new;
END;
$$;
DROP TRIGGER IF EXISTS stories_validate_music ON public.stories;
CREATE TRIGGER stories_validate_music
BEFORE INSERT OR UPDATE OF music_url,music_title,music_rights_confirmed,user_id
ON public.stories FOR EACH ROW EXECUTE FUNCTION public.validate_story_music();
