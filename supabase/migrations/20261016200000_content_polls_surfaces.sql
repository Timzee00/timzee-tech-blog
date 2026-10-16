
-- Multi-surface polls: video comment drawers, ephemeral stories, and chat/group messages.
CREATE TABLE IF NOT EXISTS public.content_polls(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 target_kind text NOT NULL CHECK(target_kind IN ('video','story','chat')),
 target_id uuid NOT NULL,
 creator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 question text NOT NULL CHECK(length(btrim(question)) BETWEEN 3 AND 280),
 options jsonb NOT NULL,
 ends_at timestamptz,
 closed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(target_kind,target_id),
 CHECK(jsonb_typeof(options)='array' AND jsonb_array_length(options) BETWEEN 2 AND 6)
);
CREATE TABLE IF NOT EXISTS public.content_poll_votes(
 poll_id uuid NOT NULL REFERENCES public.content_polls(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 option_index smallint NOT NULL CHECK(option_index BETWEEN 0 AND 5),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(poll_id,user_id)
);
CREATE INDEX IF NOT EXISTS poll_lookup_target_idx ON public.content_polls(target_kind,target_id);
ALTER TABLE public.content_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.content_poll_votes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.content_polls,public.content_poll_votes FROM anon,authenticated;
GRANT SELECT ON public.content_polls,public.content_poll_votes TO service_role;
-- Every action goes through caller-verified RPCs; no raw client writes.
CREATE OR REPLACE FUNCTION public.poll_target_access(p_kind text,p_target uuid,p_actor uuid,p_creator_only boolean DEFAULT false)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_creator uuid;v_access boolean:=false;
BEGIN
 IF p_actor IS NULL THEN RETURN false; END IF;
 IF p_kind='video' THEN
  SELECT v.user_id,(v.is_public OR v.user_id=p_actor) INTO v_creator,v_access
   FROM public.videos v WHERE v.id=p_target;
 ELSIF p_kind='story' THEN
  SELECT s.user_id,
    (s.expires_at>now() AND (s.visibility='public' OR s.user_id=p_actor OR EXISTS (
      SELECT 1 FROM public.friendships f WHERE f.status='accepted'
       AND ((f.requester_id=p_actor AND f.addressee_id=s.user_id)
        OR (f.addressee_id=p_actor AND f.requester_id=s.user_id)))))
    INTO v_creator,v_access FROM public.stories s WHERE s.id=p_target;
 ELSIF p_kind='chat' THEN
  SELECT d.sender_id,
   (d.deleted_at IS NULL AND (d.sender_id=p_actor OR d.recipient_id=p_actor
    OR public.is_chat_member(d.thread_id,p_actor)))
    INTO v_creator,v_access FROM public.direct_messages d WHERE d.id=p_target;
 END IF;
 IF p_creator_only THEN RETURN coalesce(v_access,false) AND v_creator=p_actor; END IF;
 RETURN coalesce(v_access,false);
END $$;
REVOKE ALL ON FUNCTION public.poll_target_access(text,uuid,uuid,boolean) FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION public.create_content_poll(
 p_kind text,p_target uuid,p_question text,p_options text[],p_ends_at timestamptz DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_id uuid; v_options jsonb;
BEGIN
 IF NOT public.poll_target_access(p_kind,p_target,v_actor,true) THEN
  RAISE EXCEPTION 'Only the content creator can add a poll here' USING ERRCODE='42501';
 END IF;
 IF length(btrim(coalesce(p_question,''))) NOT BETWEEN 3 AND 280
  OR coalesce(array_length(p_options,1),0) NOT BETWEEN 2 AND 6
  OR EXISTS(SELECT 1 FROM unnest(p_options) AS x WHERE length(btrim(x)) NOT BETWEEN 1 AND 100)
  THEN RAISE EXCEPTION 'Enter a question and 2–6 valid answers' USING ERRCODE='22023'; END IF;
 IF (SELECT count(DISTINCT lower(btrim(x))) FROM unnest(p_options) AS x)<>array_length(p_options,1) THEN
  RAISE EXCEPTION 'Poll answers must be different' USING ERRCODE='22023';
 END IF;
 IF p_ends_at IS NOT NULL AND (p_ends_at<=now()+interval '5 minutes' OR p_ends_at>now()+interval '365 days') THEN
  RAISE EXCEPTION 'Poll deadline must be 5 minutes to 365 days from now' USING ERRCODE='22023';
 END IF;
 SELECT jsonb_agg(btrim(x) ORDER BY ord) INTO v_options
 FROM unnest(p_options) WITH ORDINALITY AS u(x,ord);
 INSERT INTO public.content_polls(target_kind,target_id,creator_id,question,options,ends_at)
 VALUES(p_kind,p_target,v_actor,btrim(p_question),v_options,p_ends_at) RETURNING id INTO v_id;
 RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.create_content_poll(text,uuid,text,text[],timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.create_content_poll(text,uuid,text,text[],timestamptz) TO authenticated;

CREATE OR REPLACE FUNCTION public.vote_content_poll(p_poll uuid,p_option smallint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid(); v_poll public.content_polls%rowtype;
BEGIN
 SELECT * INTO v_poll FROM public.content_polls WHERE id=p_poll FOR UPDATE;
 IF NOT FOUND OR NOT public.poll_target_access(v_poll.target_kind,v_poll.target_id,v_actor,false) THEN
  RAISE EXCEPTION 'You cannot vote on this poll' USING ERRCODE='42501';
 END IF;
 IF v_poll.closed_at IS NOT NULL OR (v_poll.ends_at IS NOT NULL AND v_poll.ends_at<=now()) THEN
  RAISE EXCEPTION 'This poll has closed' USING ERRCODE='22023';
 END IF;
 IF p_option<0 OR p_option>=jsonb_array_length(v_poll.options) THEN
  RAISE EXCEPTION 'Choose a valid answer' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.content_poll_votes(poll_id,user_id,option_index)
 VALUES(p_poll,v_actor,p_option)
 ON CONFLICT(poll_id,user_id) DO UPDATE SET option_index=excluded.option_index,created_at=now();
END $$;
REVOKE ALL ON FUNCTION public.vote_content_poll(uuid,smallint) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.vote_content_poll(uuid,smallint) TO authenticated;

CREATE OR REPLACE FUNCTION public.close_content_poll(p_poll uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();
BEGIN
 UPDATE public.content_polls SET closed_at=now()
 WHERE id=p_poll AND creator_id=v_actor AND closed_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'Poll not found or already closed' USING ERRCODE='42501'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.close_content_poll(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.close_content_poll(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.polls_for_targets(p_kind text,p_targets uuid[])
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE v_actor uuid:=auth.uid();v_result jsonb;
BEGIN
 IF v_actor IS NULL THEN RETURN '[]'::jsonb; END IF;
 IF coalesce(array_length(p_targets,1),0)>80 THEN
  RAISE EXCEPTION 'Too many poll targets in one request' USING ERRCODE='22023';
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
  'id',p.id,'target_id',p.target_id,'kind',p.target_kind,'question',p.question,
  'options',p.options,'ends_at',p.ends_at,'closed_at',p.closed_at,
  'mine',p.creator_id=v_actor,'created_at',p.created_at,
  'my_vote',(SELECT v.option_index FROM public.content_poll_votes v WHERE v.poll_id=p.id AND v.user_id=v_actor),
  'counts',(SELECT coalesce(jsonb_agg(c.n ORDER BY c.idx),'[]'::jsonb) FROM
       (SELECT n.idx,count(v.user_id)::integer AS n
        FROM generate_series(0,jsonb_array_length(p.options)-1) AS n(idx)
        LEFT JOIN public.content_poll_votes v ON v.poll_id=p.id AND v.option_index=n.idx
        GROUP BY n.idx) c)
  )), '[]'::jsonb) INTO v_result
 FROM public.content_polls p
 WHERE p.target_kind=p_kind AND p.target_id=ANY(p_targets)
   AND public.poll_target_access(p.target_kind,p.target_id,v_actor,false);
 RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.polls_for_targets(text,uuid[]) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.polls_for_targets(text,uuid[]) TO authenticated;
