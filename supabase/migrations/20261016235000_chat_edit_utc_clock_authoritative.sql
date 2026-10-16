-- Direct-message timestamps are stored as UTC timestamp without time zone.
-- Do not rely on a member device's local timezone or clock for edit eligibility.
CREATE OR REPLACE FUNCTION public.can_edit_chat_message(p_message_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.direct_messages dm
    WHERE dm.id=p_message_id AND dm.sender_id=(SELECT auth.uid())
      AND dm.deleted_at IS NULL
      AND dm.created_at <= (now() AT TIME ZONE 'UTC') + interval '1 minute'
      AND dm.created_at > (now() AT TIME ZONE 'UTC') - interval '15 minutes'
  );
$$;
REVOKE ALL ON FUNCTION public.can_edit_chat_message(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.can_edit_chat_message(uuid) TO authenticated;

-- Use UTC arithmetic against the column's actual timestamp type.
CREATE OR REPLACE FUNCTION public.edit_chat_message(
 p_message_id uuid,p_new_body text,p_expected_body text)
RETURNS public.direct_messages LANGUAGE plpgsql SECURITY DEFINER
SET search_path=pg_catalog,public AS $$
DECLARE
 v_actor uuid:=(SELECT auth.uid());
 v_row public.direct_messages%ROWTYPE;
 v_result public.direct_messages%ROWTYPE;
 v_body text:=btrim(coalesce(p_new_body,''));
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Sign in to edit messages' USING ERRCODE='42501'; END IF;
 SELECT dm.* INTO v_row FROM public.direct_messages dm
 WHERE dm.id=p_message_id FOR UPDATE;
 IF NOT FOUND OR v_row.sender_id IS DISTINCT FROM v_actor THEN
  RAISE EXCEPTION 'Only the sender can edit this message' USING ERRCODE='42501';
 END IF;
 IF v_row.deleted_at IS NOT NULL THEN
  RAISE EXCEPTION 'An unsent message cannot be edited' USING ERRCODE='22023';
 END IF;
 IF v_row.created_at > (now() AT TIME ZONE 'UTC')+interval '1 minute'
 OR v_row.created_at <= (now() AT TIME ZONE 'UTC')-interval '15 minutes' THEN
  RAISE EXCEPTION 'Edit window expired (15 minutes)' USING ERRCODE='22023';
 END IF;
 IF length(v_body)>10000 THEN RAISE EXCEPTION 'Message too long' USING ERRCODE='22023'; END IF;
 IF v_body='' AND v_row.media_path IS NULL AND nullif(v_row.media_url,'') IS NULL THEN
  RAISE EXCEPTION 'Cannot empty a text message; use Unsend instead' USING ERRCODE='22023';
 END IF;
 IF v_row.body IS DISTINCT FROM p_expected_body THEN
  RAISE EXCEPTION 'Message changed on another device. Reload before editing.' USING ERRCODE='40001';
 END IF;
 IF v_row.body IS NOT DISTINCT FROM v_body THEN RETURN v_row; END IF;
 UPDATE public.direct_messages dm SET body=v_body,edited_at=now(),edit_count=coalesce(dm.edit_count,0)+1
 WHERE dm.id=p_message_id RETURNING dm.* INTO v_result;
 RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.edit_chat_message(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.edit_chat_message(uuid,text,text) TO authenticated;