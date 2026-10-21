-- Authorize cross-surface @mention notifications from persisted, audience-visible content.
CREATE OR REPLACE FUNCTION public.valid_social_mention(
 p_type text,p_payload jsonb,p_target uuid,p_sender uuid
) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_id uuid;v_name text;v_body text;v_access boolean:=false;
BEGIN
 IF p_target IS NULL OR p_sender IS NULL OR p_target=p_sender THEN RETURN false; END IF;
 SELECT p.username INTO v_name FROM public.profiles p WHERE p.id=p_target;
 IF v_name IS NULL OR v_name !~ '^[a-zA-Z0-9_]{1,32}$' THEN RETURN false; END IF;
 IF p_type='group_mention' THEN
   v_id:=nullif(p_payload->>'message_id','')::uuid;
   SELECT dm.body,
     (dm.sender_id=p_sender AND dm.recipient_id IS NULL
      AND public.is_chat_member(dm.thread_id,p_target))
   INTO v_body,v_access FROM public.direct_messages dm WHERE dm.id=v_id;
 ELSIF p_type='status_mention' THEN
   v_id:=nullif(p_payload->>'story_id','')::uuid;
   SELECT s.caption,(s.user_id=p_sender AND s.expires_at>now() AND
     (s.visibility='public' OR EXISTS(
       SELECT 1 FROM public.friendships f WHERE f.status='accepted'
        AND ((f.requester_id=p_target AND f.addressee_id=s.user_id)
          OR(f.addressee_id=p_target AND f.requester_id=s.user_id)))))
   INTO v_body,v_access FROM public.stories s WHERE s.id=v_id;
 ELSIF p_type='video_mention' THEN
   v_id:=nullif(p_payload->>'comment_id','')::uuid;
   SELECT c.body,(c.user_id=p_sender AND v.is_public)
    INTO v_body,v_access FROM public.video_comments c
     JOIN public.videos v ON v.id=c.video_id WHERE c.id=v_id;
 ELSIF p_type='status_comment_mention' THEN
   v_id:=nullif(p_payload->>'comment_id','')::uuid;
   SELECT c.body,(c.user_id=p_sender AND s.expires_at>now() AND
     (s.visibility='public' OR EXISTS(
       SELECT 1 FROM public.friendships f WHERE f.status='accepted'
        AND ((f.requester_id=p_target AND f.addressee_id=s.user_id)
         OR(f.addressee_id=p_target AND f.requester_id=s.user_id)))))
   INTO v_body,v_access FROM public.story_comments c
    JOIN public.stories s ON s.id=c.story_id WHERE c.id=v_id;
 ELSE RETURN false;
 END IF;
 RETURN coalesce(v_access,false)
  AND regexp_like(coalesce(v_body,''),'(^|[^[:alnum:]_])@'||v_name||'([^[:alnum:]_]|$)','i');
EXCEPTION WHEN invalid_text_representation THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.valid_social_mention(text,jsonb,uuid,uuid) FROM PUBLIC,anon,authenticated;
