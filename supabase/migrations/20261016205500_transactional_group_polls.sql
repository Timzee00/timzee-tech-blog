
CREATE OR REPLACE FUNCTION public.create_group_poll(
 p_thread uuid,p_question text,p_options text[],p_ends_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_row public.chat_threads%ROWTYPE;v_msg uuid;
BEGIN
 SELECT * INTO v_row FROM public.chat_threads t WHERE t.id=p_thread AND t.is_group;
 IF NOT FOUND OR NOT public.is_chat_member(p_thread::text,v_actor) THEN
  RAISE EXCEPTION 'Group membership required' USING ERRCODE='42501';
 END IF;
 IF coalesce((v_row.settings->>'allow_polls')::boolean,true)=false THEN
  RAISE EXCEPTION 'Polls are disabled in this group' USING ERRCODE='42501';
 END IF;
 -- Group posting and slow-mode triggers enforce the actor's messaging permissions.
 INSERT INTO public.direct_messages(id,thread_id,sender_id,recipient_id,body,created_at)
 VALUES(gen_random_uuid(),p_thread::text,v_actor,NULL,'📊 Poll: '||left(btrim(p_question),280),now())
 RETURNING id INTO v_msg;
 PERFORM public.create_content_poll('chat',v_msg,p_question,p_options,p_ends_at);
 RETURN v_msg;
END $$;
REVOKE ALL ON FUNCTION public.create_group_poll(uuid,text,text[],timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_group_poll(uuid,text,text[],timestamptz) TO authenticated;
