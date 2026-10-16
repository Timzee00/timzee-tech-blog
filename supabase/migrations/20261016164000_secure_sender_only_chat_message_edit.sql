-- Sender-only message editing with an enforceable 15-minute window.
-- An edited text or media caption is marked, and unchanged content is a no-op.
ALTER TABLE public.direct_messages
  ADD COLUMN IF NOT EXISTS edited_at timestamptz,
  ADD COLUMN IF NOT EXISTS edit_count integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.edit_chat_message(
  p_message_id uuid,
  p_new_body text,
  p_expected_body text
)
RETURNS public.direct_messages
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_row public.direct_messages%ROWTYPE;
  v_result public.direct_messages%ROWTYPE;
  v_body text := btrim(coalesce(p_new_body, ''));
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Sign in to edit messages' USING ERRCODE='42501';
  END IF;

  SELECT dm.* INTO v_row FROM public.direct_messages dm
  WHERE dm.id = p_message_id FOR UPDATE;
  IF NOT FOUND OR v_row.sender_id IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Only the sender can edit this message' USING ERRCODE='42501';
  END IF;
  IF v_row.deleted_at IS NOT NULL THEN
    RAISE EXCEPTION 'An unsent message cannot be edited' USING ERRCODE='22023';
  END IF;
  IF v_row.created_at IS NULL
     OR v_row.created_at AT TIME ZONE 'UTC' > now() + interval '1 minute'
     OR v_row.created_at AT TIME ZONE 'UTC' < now() - interval '15 minutes' THEN
    RAISE EXCEPTION 'Messages can only be edited within 15 minutes of sending' USING ERRCODE='22023';
  END IF;
  IF length(v_body) > 10000 THEN
    RAISE EXCEPTION 'Message is too long (10,000 characters maximum)' USING ERRCODE='22023';
  END IF;
  IF v_body = '' AND v_row.media_path IS NULL
     AND nullif(v_row.media_url, '') IS NULL THEN
    RAISE EXCEPTION 'A text message cannot be empty; use Unsend instead' USING ERRCODE='22023';
  END IF;
  -- Detect multi-device races; never overwrite a newer version silently.
  IF v_row.body IS DISTINCT FROM p_expected_body THEN
    RAISE EXCEPTION 'Message changed on another device. Reload it before editing.' USING ERRCODE='40001';
  END IF;
  IF v_row.body IS NOT DISTINCT FROM v_body THEN
    RETURN v_row;
  END IF;

  UPDATE public.direct_messages AS dm
  SET body = v_body, edited_at = now(), edit_count = coalesce(dm.edit_count,0) + 1
  WHERE dm.id=p_message_id
  RETURNING dm.* INTO v_result;
  RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.edit_chat_message(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_chat_message(uuid,text,text) TO authenticated;
