
-- Native, one-per-thread community polls, expiry enforced on the database clock.
CREATE TABLE IF NOT EXISTS public.community_polls(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 thread_id uuid NOT NULL UNIQUE REFERENCES public.community_threads(id) ON DELETE CASCADE,
 creator_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 question text NOT NULL CHECK(length(btrim(question)) BETWEEN 5 AND 300),
 options text[] NOT NULL CHECK(array_length(options,1) BETWEEN 2 AND 6),
 ends_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 closed_at timestamptz,
 CHECK(ends_at IS NULL OR ends_at>created_at)
);
CREATE INDEX IF NOT EXISTS community_polls_end_idx ON public.community_polls(ends_at) WHERE ends_at IS NOT NULL;
CREATE TABLE IF NOT EXISTS public.community_poll_votes(
 poll_id uuid NOT NULL REFERENCES public.community_polls(id) ON DELETE CASCADE,
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 option_number smallint NOT NULL CHECK(option_number BETWEEN 1 AND 6),
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(poll_id,user_id)
);
CREATE INDEX IF NOT EXISTS community_poll_votes_tally ON public.community_poll_votes(poll_id,option_number);
ALTER TABLE public.community_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_poll_votes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_polls,public.community_poll_votes FROM anon,authenticated;
GRANT SELECT ON public.community_polls TO anon,authenticated;
GRANT SELECT ON public.community_poll_votes TO authenticated;
CREATE POLICY community_poll_visible ON public.community_polls FOR SELECT TO anon,authenticated
USING(EXISTS(SELECT 1 FROM public.community_threads t WHERE t.id=thread_id
 AND public.community_can_read(t.community_id,auth.uid())));
CREATE POLICY community_poll_my_vote ON public.community_poll_votes FOR SELECT TO authenticated
USING(user_id=auth.uid());

CREATE OR REPLACE FUNCTION public.community_create_poll(
 p_thread uuid,p_question text,p_options text[],p_ends_at timestamptz DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_thread public.community_threads%ROWTYPE;v_result uuid;v_item text;v_clean text[]:='{}';
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to create polls' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_thread FROM public.community_threads WHERE id=p_thread;
 IF NOT FOUND OR v_thread.status<>'published'
   OR NOT public.community_can_read(v_thread.community_id,auth.uid()) THEN
  RAISE EXCEPTION 'This topic is unavailable' USING ERRCODE='42501';
 END IF;
 IF v_thread.author_id IS DISTINCT FROM auth.uid() AND
   NOT public.community_is_moderator(v_thread.community_id,auth.uid()) THEN
  RAISE EXCEPTION 'Only topic authors or moderators can create a poll' USING ERRCODE='42501';
 END IF;
 IF length(btrim(coalesce(p_question,''))) NOT BETWEEN 5 AND 300
   OR coalesce(array_length(p_options,1),0) NOT BETWEEN 2 AND 6 THEN
  RAISE EXCEPTION 'Poll needs a question and 2–6 options' USING ERRCODE='22023';
 END IF;
 FOREACH v_item IN ARRAY p_options LOOP
  IF length(btrim(coalesce(v_item,''))) NOT BETWEEN 1 AND 120 THEN
   RAISE EXCEPTION 'Each option must be 1–120 characters' USING ERRCODE='22023';
  END IF;
  v_clean:=array_append(v_clean,btrim(v_item));
 END LOOP;
 IF (SELECT count(DISTINCT lower(v)) FROM unnest(v_clean) AS v)<>array_length(v_clean,1) THEN
   RAISE EXCEPTION 'Poll options must be distinct' USING ERRCODE='22023';
 END IF;
 IF p_ends_at IS NOT NULL AND
   (p_ends_at<now()+interval '10 minutes' OR p_ends_at>now()+interval '90 days') THEN
   RAISE EXCEPTION 'Closing time must be 10 minutes to 90 days away' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.community_polls(thread_id,creator_id,question,options,ends_at)
 VALUES(p_thread,auth.uid(),btrim(p_question),v_clean,p_ends_at)
 RETURNING id INTO v_result;
 RETURN v_result;
END $$;

CREATE OR REPLACE FUNCTION public.community_vote_poll(p_poll uuid,p_option smallint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_poll public.community_polls%ROWTYPE;v_board uuid;
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sign in to vote' USING ERRCODE='42501'; END IF;
 SELECT * INTO v_poll FROM public.community_polls WHERE id=p_poll FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Poll not found' USING ERRCODE='22023'; END IF;
 SELECT community_id INTO v_board FROM public.community_threads WHERE id=v_poll.thread_id AND status='published';
 IF v_board IS NULL OR NOT public.community_can_read(v_board,auth.uid()) THEN
  RAISE EXCEPTION 'Poll unavailable' USING ERRCODE='42501';
 END IF;
 IF v_poll.closed_at IS NOT NULL OR (v_poll.ends_at IS NOT NULL AND v_poll.ends_at<=now()) THEN
  RAISE EXCEPTION 'Voting is closed' USING ERRCODE='22023';
 END IF;
 IF p_option<1 OR p_option>array_length(v_poll.options,1) THEN
  RAISE EXCEPTION 'Invalid option' USING ERRCODE='22023';
 END IF;
 INSERT INTO public.community_poll_votes(poll_id,user_id,option_number)
 VALUES(p_poll,auth.uid(),p_option)
 ON CONFLICT(poll_id,user_id) DO UPDATE SET
 option_number=excluded.option_number,created_at=now();
END $$;

CREATE OR REPLACE FUNCTION public.community_poll_summary(p_thread uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_poll public.community_polls%ROWTYPE;v_board uuid;v_vote smallint;v_total bigint;
 v_options jsonb;
BEGIN
 SELECT community_id INTO v_board FROM public.community_threads WHERE id=p_thread AND status='published';
 IF v_board IS NULL OR NOT public.community_can_read(v_board,auth.uid()) THEN
  RETURN NULL;
 END IF;
 SELECT * INTO v_poll FROM public.community_polls WHERE thread_id=p_thread;
 IF NOT FOUND THEN RETURN NULL; END IF;
 SELECT option_number INTO v_vote FROM public.community_poll_votes
 WHERE poll_id=v_poll.id AND user_id=auth.uid();
 SELECT count(*) INTO v_total FROM public.community_poll_votes WHERE poll_id=v_poll.id;
 SELECT jsonb_agg(jsonb_build_object('number',n,'label',v_poll.options[n],
  'votes',CASE WHEN v_vote IS NOT NULL OR
    (v_poll.ends_at IS NOT NULL AND v_poll.ends_at<=now()) OR v_poll.closed_at IS NOT NULL
    OR v_poll.creator_id=auth.uid() THEN
     (SELECT count(*) FROM public.community_poll_votes v
      WHERE v.poll_id=v_poll.id AND v.option_number=n) ELSE NULL END)
 ORDER BY n) INTO v_options FROM generate_subscripts(v_poll.options,1) n;
 RETURN jsonb_build_object('id',v_poll.id,'question',v_poll.question,
  'options',v_options,'ends_at',v_poll.ends_at,'closed_at',v_poll.closed_at,
  'my_vote',v_vote,'total_votes',v_total,
  'results_visible',v_vote IS NOT NULL OR v_poll.creator_id=auth.uid()
    OR v_poll.closed_at IS NOT NULL OR
    (v_poll.ends_at IS NOT NULL AND v_poll.ends_at<=now()));
END $$;
REVOKE ALL ON FUNCTION public.community_create_poll(uuid,text,text[],timestamptz) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.community_vote_poll(uuid,smallint) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.community_poll_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.community_create_poll(uuid,text,text[],timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_vote_poll(uuid,smallint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.community_poll_summary(uuid) TO anon,authenticated;
