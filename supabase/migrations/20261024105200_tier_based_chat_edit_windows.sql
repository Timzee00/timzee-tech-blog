-- Verified members receive longer editing windows. Both capability check
-- and the actual update enforce this server-side using trusted profile data.
CREATE OR REPLACE FUNCTION private.chat_message_edit_window(p_sender uuid)
 RETURNS interval LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog','public','private'
AS $window$
 SELECT coalesce((
  SELECT CASE
   WHEN p.is_verified IS TRUE
     AND (p.verification_expires_at IS NULL OR p.verification_expires_at > now())
     AND lower(coalesce(p.verification_tier,'')) IN ('platinum','business')
       THEN interval '72 hours'
   WHEN p.is_verified IS TRUE
     AND (p.verification_expires_at IS NULL OR p.verification_expires_at > now())
     AND lower(coalesce(p.verification_tier,'')) IN ('silver','gold')
       THEN interval '24 hours'
   ELSE interval '15 minutes' END
  FROM public.profiles p WHERE p.id=p_sender
 ),interval '15 minutes');
$window$;
REVOKE ALL ON FUNCTION private.chat_message_edit_window(uuid) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.can_edit_chat_message(p_message_id uuid)
 RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog','public','private'
AS $can$
 SELECT EXISTS(
  SELECT 1 FROM public.direct_messages dm
  WHERE dm.id=p_message_id AND dm.sender_id=(SELECT auth.uid())
   AND dm.deleted_at IS NULL
   AND dm.created_at<=(now() AT TIME ZONE 'UTC')+interval '1 minute'
   AND dm.created_at>(now() AT TIME ZONE 'UTC')-
     private.chat_message_edit_window(dm.sender_id)
 );
$can$;

CREATE OR REPLACE FUNCTION public.edit_chat_message(
 p_message_id uuid,p_new_body text,p_expected_body text)
 RETURNS public.direct_messages LANGUAGE plpgsql SECURITY DEFINER
 SET search_path TO 'pg_catalog','public','private'
AS $edit$
DECLARE
 v_actor uuid:=(SELECT auth.uid());
 v_row public.direct_messages%ROWTYPE;
 v_result public.direct_messages%ROWTYPE;
 v_body text:=btrim(coalesce(p_new_body,''));
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Sign in to edit messages' USING ERRCODE='42501';END IF;
 SELECT dm.* INTO v_row FROM public.direct_messages dm WHERE dm.id=p_message_id FOR UPDATE;
 IF NOT FOUND OR v_row.sender_id IS DISTINCT FROM v_actor THEN
  RAISE EXCEPTION 'Only the sender can edit this message' USING ERRCODE='42501';
 END IF;
 IF v_row.deleted_at IS NOT NULL THEN
  RAISE EXCEPTION 'An unsent message cannot be edited' USING ERRCODE='22023';
 END IF;
 IF v_row.created_at>(now() AT TIME ZONE 'UTC')+interval '1 minute'
 OR v_row.created_at<=(now() AT TIME ZONE 'UTC')-
    private.chat_message_edit_window(v_actor) THEN
  RAISE EXCEPTION 'Your edit window expired' USING ERRCODE='22023';
 END IF;
 IF length(v_body)>10000 THEN RAISE EXCEPTION 'Message too long' USING ERRCODE='22023';END IF;
 IF v_body='' AND v_row.media_path IS NULL AND nullif(v_row.media_url,'') IS NULL THEN
  RAISE EXCEPTION 'Cannot empty a text message; use Unsend instead' USING ERRCODE='22023';
 END IF;
 IF v_row.body IS DISTINCT FROM p_expected_body THEN
  RAISE EXCEPTION 'Message changed on another device. Reload before editing.' USING ERRCODE='40001';
 END IF;
 IF v_row.body IS NOT DISTINCT FROM v_body THEN RETURN v_row;END IF;
 UPDATE public.direct_messages dm
  SET body=v_body,edited_at=now(),edit_count=coalesce(dm.edit_count,0)+1
  WHERE dm.id=p_message_id RETURNING dm.* INTO v_result;
 RETURN v_result;
END;
$edit$;
