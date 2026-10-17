-- Explainable automatic moderation: suspicious content is queued for humans, never silently deleted.
CREATE TABLE IF NOT EXISTS public.community_auto_moderation(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 target_type text NOT NULL CHECK(target_type IN ('thread','reply')),
 target_id uuid NOT NULL,
 community_id uuid NOT NULL REFERENCES public.discussion_topics(id) ON DELETE CASCADE,
 author_id uuid,
 signals text[] NOT NULL DEFAULT '{}',
 risk_score integer NOT NULL CHECK(risk_score BETWEEN 0 AND 100),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','reviewed','dismissed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 reviewed_by uuid,
 reviewed_at timestamptz,
 UNIQUE(target_type,target_id)
);
CREATE INDEX IF NOT EXISTS community_auto_mod_queue_idx ON public.community_auto_moderation(community_id,state,created_at DESC);
ALTER TABLE public.community_auto_moderation ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_auto_moderation FROM public,anon,authenticated;
GRANT SELECT ON public.community_auto_moderation TO authenticated;
CREATE POLICY community_auto_mod_staff_read ON public.community_auto_moderation FOR SELECT TO authenticated
USING(coalesce(public.has_role_secure('super'),false) OR coalesce(public.has_role_secure('admin'),false)
 OR EXISTS(SELECT 1 FROM public.community_members m WHERE m.community_id=community_auto_moderation.community_id
 AND m.user_id=auth.uid() AND m.role IN ('owner','moderator')));
CREATE OR REPLACE FUNCTION public.community_auto_mod_signal()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_text text;v_signals text[]:=ARRAY[]::text[];v_risk int:=0;v_board uuid;v_type text;
BEGIN
 IF TG_TABLE_NAME='community_threads' THEN
  v_text:=coalesce(new.title,'')||' '||coalesce(new.body,'');
  v_board:=new.community_id;v_type:='thread';
 ELSE
  v_text:=coalesce(new.body,'');v_type:='reply';
  SELECT t.community_id INTO v_board FROM public.community_threads t WHERE t.id=new.thread_id;
 END IF;
 IF v_board IS NULL THEN RETURN new; END IF;
 IF (SELECT count(*) FROM regexp_matches(v_text,'https?://','gi'))>=4 THEN
  v_signals:=array_append(v_signals,'excessive_links');v_risk:=v_risk+45;
 END IF;
 IF v_text ~* '(free money|guaranteed returns|double your money|click here now)' THEN
  v_signals:=array_append(v_signals,'possible_solicitation');v_risk:=v_risk+30;
 END IF;
 IF length(v_text)>=40 AND length(regexp_replace(v_text,'[^!]','','g'))>20 THEN
  v_signals:=array_append(v_signals,'repetitive_punctuation');v_risk:=v_risk+20;
 END IF;
 IF v_risk>=30 THEN
  INSERT INTO public.community_auto_moderation(target_type,target_id,community_id,author_id,signals,risk_score)
  VALUES(v_type,new.id,v_board,new.author_id,v_signals,least(v_risk,100))
  ON CONFLICT(target_type,target_id) DO NOTHING;
 END IF;
 RETURN new;
END $$;
CREATE TRIGGER community_thread_auto_mod AFTER INSERT ON public.community_threads
FOR EACH ROW EXECUTE FUNCTION public.community_auto_mod_signal();
CREATE TRIGGER community_reply_auto_mod AFTER INSERT ON public.discussion_messages
FOR EACH ROW EXECUTE FUNCTION public.community_auto_mod_signal();
CREATE OR REPLACE FUNCTION public.community_review_auto_flag(p_id bigint,p_resolution text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_board uuid;
BEGIN
 IF p_resolution NOT IN ('reviewed','dismissed') THEN RAISE EXCEPTION 'Invalid resolution'; END IF;
 SELECT community_id INTO v_board FROM public.community_auto_moderation WHERE id=p_id;
 IF v_board IS NULL OR NOT(coalesce(public.has_role_secure('super'),false)
 OR coalesce(public.has_role_secure('admin'),false)
 OR EXISTS(SELECT 1 FROM public.community_members m WHERE m.community_id=v_board
 AND m.user_id=auth.uid() AND m.role IN ('owner','moderator'))) THEN
 RAISE EXCEPTION 'Moderator permission required' USING ERRCODE='42501';
 END IF;
 UPDATE public.community_auto_moderation SET state=p_resolution,reviewed_by=auth.uid(),reviewed_at=now()
 WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION public.community_review_auto_flag(bigint,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.community_review_auto_flag(bigint,text) TO authenticated;
