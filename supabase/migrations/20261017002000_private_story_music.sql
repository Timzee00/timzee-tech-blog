-- Keep the music for a private story private as well.
UPDATE storage.buckets
SET allowed_mime_types=ARRAY[
 'image/jpeg','image/png','image/webp','image/gif','image/heic','image/heif',
 'video/mp4','video/webm','video/quicktime',
 'audio/mpeg','audio/mp4','audio/x-m4a','audio/ogg','audio/webm'
]
WHERE id='story-private-media';

CREATE OR REPLACE FUNCTION public.validate_story_music()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path=pg_catalog,public AS $$
DECLARE v_expected text;
BEGIN
 IF new.music_url IS NULL THEN
  new.music_title=NULL;
  new.music_rights_confirmed=false;
  RETURN new;
 END IF;
 IF new.visibility='private' THEN
  v_expected='story-private-media/'||new.user_id::text||'/music/';
 ELSE
  v_expected='https://duvbcwwprkzzyzikmcol.supabase.co/storage/v1/object/public/media/stories/' || new.user_id::text || '/';
 END IF;
 IF new.music_url NOT LIKE v_expected||'%'
   OR length(new.music_url)>1200
   OR new.music_url ~ '[?#]'
   OR NOT new.music_url ~* '\.(mp3|m4a|ogg|webm)$'
 THEN
  RAISE EXCEPTION 'Choose an audio file from your own status storage'
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
BEFORE INSERT OR UPDATE OF music_url,music_title,music_rights_confirmed,user_id,visibility
ON public.stories FOR EACH ROW EXECUTE FUNCTION public.validate_story_music();
