-- Trust the database clock, not a device-supplied created_at/expires_at.
CREATE OR REPLACE FUNCTION public.limit_story_expiration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_verified boolean:=false;v_max timestamptz;
BEGIN
 IF NEW.user_id IS DISTINCT FROM auth.uid() AND current_user<>'service_role' THEN
  RAISE EXCEPTION 'Story owner mismatch' USING ERRCODE='42501';
 END IF;
 IF TG_OP='INSERT' AND abs(extract(epoch from (NEW.created_at-now())))>120 THEN
  RAISE EXCEPTION 'Status creation time must match the server clock'
   USING ERRCODE='22023';
 END IF;
 SELECT coalesce(p.is_verified,false) INTO v_verified
 FROM public.profiles p WHERE p.id=NEW.user_id;
 v_max:=NEW.created_at+CASE WHEN v_verified THEN interval '72 hours' ELSE interval '24 hours' END;
 IF NEW.expires_at IS NULL THEN NEW.expires_at:=NEW.created_at+interval '24 hours'; END IF;
 IF NEW.expires_at>v_max OR NEW.expires_at<=NEW.created_at THEN
  RAISE EXCEPTION 'Status expiry exceeds account limit' USING ERRCODE='22023';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS story_expiration_policy ON public.stories;
CREATE TRIGGER story_expiration_policy
BEFORE INSERT OR UPDATE OF created_at,expires_at,user_id
ON public.stories FOR EACH ROW EXECUTE FUNCTION public.limit_story_expiration();

CREATE OR REPLACE FUNCTION public.publish_story(
 p_media_url text,p_media_type text,p_caption text,
 p_visibility text,p_duration_hours integer,
 p_allow_reshare boolean,p_allow_public_comments boolean,
 p_music_url text,p_music_title text,p_music_rights_confirmed boolean
) RETURNS public.stories LANGUAGE plpgsql SECURITY DEFINER
SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_verified boolean:=false;
 v_expected text;v_row public.stories%ROWTYPE;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Sign in to publish' USING ERRCODE='42501'; END IF;
 SELECT coalesce(p.is_verified,false) INTO v_verified FROM public.profiles p WHERE p.id=v_actor;
 IF p_duration_hours NOT IN (24,48,72) OR (p_duration_hours>24 AND NOT v_verified) THEN
  RAISE EXCEPTION 'This status duration requires verification' USING ERRCODE='42501';
 END IF;
 IF p_visibility NOT IN ('public','private') OR p_media_type NOT IN ('image','video') THEN
  RAISE EXCEPTION 'Invalid status visibility or format' USING ERRCODE='22023';
 END IF;
 IF length(coalesce(p_caption,''))>200 THEN
  RAISE EXCEPTION 'Status caption must not exceed 200 characters' USING ERRCODE='22023';
 END IF;
 IF p_visibility='private' THEN
  v_expected='story-private-media/'||v_actor::text||'/';
  IF p_media_url NOT LIKE v_expected||'%' OR length(p_media_url)>1100
    OR p_media_url ~ '[?#]' OR p_media_url LIKE '%..%' THEN
    RAISE EXCEPTION 'Private status must reference owner-only storage' USING ERRCODE='42501';
  END IF;
 ELSE
  v_expected='https://duvbcwwprkzzyzikmcol.supabase.co/storage/v1/object/public/media/stories/'||v_actor::text||'/';
  IF p_media_url NOT LIKE v_expected||'%' OR length(p_media_url)>1500
    OR p_media_url ~ '[?#]' OR p_media_url LIKE '%..%' THEN
    RAISE EXCEPTION 'Status must reference media in your own folder' USING ERRCODE='42501';
  END IF;
 END IF;
 INSERT INTO public.stories(user_id,media_url,media_type,caption,visibility,
 created_at,expires_at,allow_reshare,allow_public_comments,
 music_url,music_title,music_rights_confirmed)
 VALUES(v_actor,p_media_url,p_media_type,nullif(btrim(coalesce(p_caption,'')),''),
 p_visibility,now(),now()+make_interval(hours=>p_duration_hours),
 coalesce(p_allow_reshare,true),coalesce(p_allow_public_comments,true),
 p_music_url,p_music_title,coalesce(p_music_rights_confirmed,false))
 RETURNING * INTO v_row;
 RETURN v_row;
END $$;
REVOKE ALL ON FUNCTION public.publish_story(text,text,text,text,integer,boolean,boolean,text,text,boolean)
 FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.publish_story(text,text,text,text,integer,boolean,boolean,text,text,boolean)
 TO authenticated;
