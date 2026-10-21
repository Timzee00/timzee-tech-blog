-- Keep private/friends-only story media out of public resharing.
CREATE OR REPLACE FUNCTION public.reshare_status(p_story_id uuid, p_caption text DEFAULT NULL::text)
 RETURNS stories
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE v_actor uuid:=auth.uid(); v_origin public.stories%ROWTYPE; v_new public.stories%ROWTYPE;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Sign in to reshare' USING ERRCODE='42501'; END IF;
 SELECT s.* INTO v_origin FROM public.stories s WHERE s.id=p_story_id AND s.expires_at>now();
 IF NOT FOUND OR v_origin.visibility <> 'public' OR NOT v_origin.allow_reshare OR
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
END $function$
;
