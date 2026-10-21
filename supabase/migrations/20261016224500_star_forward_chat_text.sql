
-- Per-member starred messages and secure text-only forwarding.
CREATE TABLE IF NOT EXISTS public.chat_message_stars(
 message_id uuid NOT NULL REFERENCES public.direct_messages(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(message_id,user_id)
);
CREATE INDEX IF NOT EXISTS chat_stars_member_recent ON public.chat_message_stars(user_id,created_at DESC);
ALTER TABLE public.chat_message_stars ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.chat_message_stars FROM anon,authenticated;
GRANT SELECT,INSERT,DELETE ON public.chat_message_stars TO authenticated;
DROP POLICY IF EXISTS "Starred message belongs to visible conversation" ON public.chat_message_stars;
CREATE POLICY "Starred message belongs to visible conversation" ON public.chat_message_stars
 FOR SELECT TO authenticated USING(user_id=auth.uid() AND EXISTS(
 SELECT 1 FROM public.direct_messages m WHERE m.id=message_id
 AND (m.sender_id=auth.uid() OR m.recipient_id=auth.uid() OR public.is_chat_member(m.thread_id,auth.uid()))));
DROP POLICY IF EXISTS "Save visible message" ON public.chat_message_stars;
CREATE POLICY "Save visible message" ON public.chat_message_stars FOR INSERT TO authenticated
 WITH CHECK(user_id=auth.uid() AND EXISTS(
 SELECT 1 FROM public.direct_messages m WHERE m.id=message_id AND m.deleted_at IS NULL
 AND(m.sender_id=auth.uid() OR m.recipient_id=auth.uid() OR public.is_chat_member(m.thread_id,auth.uid()))));
DROP POLICY IF EXISTS "Unstar own message" ON public.chat_message_stars;
CREATE POLICY "Unstar own message" ON public.chat_message_stars FOR DELETE TO authenticated USING(user_id=auth.uid());

ALTER TABLE public.direct_messages ADD COLUMN IF NOT EXISTS forwarded_from uuid;
CREATE OR REPLACE FUNCTION public.forward_chat_text(
 p_message_id uuid,p_thread_id text,p_recipient_id uuid DEFAULT NULL)
RETURNS public.direct_messages LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_source public.direct_messages%ROWTYPE;v_result public.direct_messages%ROWTYPE;
BEGIN
 IF v_actor IS NULL THEN RAISE EXCEPTION 'Sign in to forward' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_source FROM public.direct_messages m WHERE m.id=p_message_id AND m.deleted_at IS NULL;
 IF NOT FOUND OR NOT(v_source.sender_id=v_actor OR v_source.recipient_id=v_actor
    OR public.is_chat_member(v_source.thread_id,v_actor)) THEN
   RAISE EXCEPTION 'You cannot forward this message' USING ERRCODE='42501';
 END IF;
 IF coalesce(length(btrim(v_source.body)),0)=0 THEN
   RAISE EXCEPTION 'Only text and captions can be forwarded in this version' USING ERRCODE='22023';
 END IF;
 IF v_source.media_url IS NOT NULL OR v_source.media_path IS NOT NULL THEN
   RAISE EXCEPTION 'Media forwarding requires re-upload consent. Text-only forwarding is available.' USING ERRCODE='22023';
 END IF;
 IF p_recipient_id IS NULL THEN
   IF NOT public.is_chat_member(p_thread_id,v_actor) OR
      NOT EXISTS(SELECT 1 FROM public.chat_threads t WHERE t.id::text=p_thread_id AND t.is_group) THEN
      RAISE EXCEPTION 'Not a member of destination group' USING ERRCODE='42501';
   END IF;
 ELSE
   IF p_recipient_id=v_actor OR p_thread_id<>LEAST(v_actor,p_recipient_id)::text||'_'||GREATEST(v_actor,p_recipient_id)::text
     OR NOT public.can_send_direct_message(p_recipient_id) THEN
     RAISE EXCEPTION 'Recipient does not accept messages' USING ERRCODE='42501';
   END IF;
 END IF;
 INSERT INTO public.direct_messages(id,thread_id,sender_id,recipient_id,body,forwarded_from,created_at)
 VALUES(gen_random_uuid(),p_thread_id,v_actor,p_recipient_id,v_source.body,p_message_id,now())
 RETURNING * INTO v_result;
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.forward_chat_text(uuid,text,uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.forward_chat_text(uuid,text,uuid) TO authenticated;
