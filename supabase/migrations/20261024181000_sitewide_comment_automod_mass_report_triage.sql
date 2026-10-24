
-- Extend community anti-spam with evidence-based sitewide comment triage
-- and coordinated-report escalation. Never auto-ban on report volume alone.
CREATE TABLE IF NOT EXISTS public.moderation_automated_flags(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 target_type text NOT NULL,
 target_id uuid NOT NULL,
 risk_score integer NOT NULL CHECK(risk_score BETWEEN 0 AND 100),
 signals text[] NOT NULL DEFAULT ARRAY[]::text[],
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','reviewed','dismissed')),
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(target_type,target_id)
);
CREATE INDEX IF NOT EXISTS site_automod_open_queue
 ON public.moderation_automated_flags(risk_score DESC,created_at DESC) WHERE state='pending';
ALTER TABLE public.moderation_automated_flags ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moderation_automated_flags FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.moderation_automated_flags TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.moderation_automated_flags_id_seq TO service_role;

ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS automod_score integer NOT NULL DEFAULT 0;
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS automod_signals text[] NOT NULL DEFAULT ARRAY[]::text[];
ALTER TABLE public.comments ADD COLUMN IF NOT EXISTS moderation_reason text;
DROP POLICY IF EXISTS comments_author_read_own_pending ON public.comments;
CREATE POLICY comments_author_read_own_pending ON public.comments FOR SELECT TO authenticated
USING(author_id=(select auth.uid()));

CREATE OR REPLACE FUNCTION private.classify_comment_for_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $check$
DECLARE content text:=coalesce(new.body,'');v_score integer:=0;
 v_signals text[]:=ARRAY[]::text[];v_links integer:=0;v_repeats boolean:=false;
BEGIN
 -- Always recompute risk on the server; the browser cannot assign trusted scores.
 SELECT count(*) INTO v_links FROM regexp_matches(content,'https?://','gi');
 IF v_links>=3 THEN
  v_score:=v_score+65;v_signals:=array_append(v_signals,'excessive_links');
 END IF;
 IF content ~* '(free money|guaranteed returns|double your money|click here now|send your password)' THEN
  v_score:=v_score+40;v_signals:=array_append(v_signals,'possible_scam');
 END IF;
 -- These phrases are narrow, actionable indicators. A human decides guilt.
 IF content ~* '(kill yourself|i will kill you|i am going to hurt you|i will hurt you)' THEN
  v_score:=v_score+85;v_signals:=array_append(v_signals,'possible_direct_threat');
 END IF;
 IF length(content)>=40 AND length(regexp_replace(content,'[^!]','','g'))>=18 THEN
  v_score:=v_score+25;v_signals:=array_append(v_signals,'excessive_punctuation');
 END IF;
 IF new.author_id IS NOT NULL THEN
  SELECT EXISTS(
   SELECT 1 FROM public.comments c WHERE c.author_id=new.author_id
     AND c.created_at>now()-interval '30 minutes' AND length(btrim(coalesce(c.body,'')))>=25
     AND lower(btrim(c.body))=lower(btrim(content))
  ) INTO v_repeats;
  IF v_repeats THEN
   v_score:=v_score+65;v_signals:=array_append(v_signals,'repeated_identical_comment');
  END IF;
  IF (SELECT count(*) FROM public.comments c
     WHERE c.author_id=new.author_id AND c.created_at>now()-interval '2 minutes')>=7 THEN
   v_score:=v_score+35;v_signals:=array_append(v_signals,'high_comment_frequency');
  END IF;
 END IF;
 new.automod_score:=least(v_score,100);new.automod_signals:=v_signals;
 IF new.automod_score>=65 THEN
  new.status:='pending';
  new.moderation_reason:='Temporarily held for automated safety review';
 ELSIF new.automod_score>=35 THEN
  new.moderation_reason:='Flagged for moderator review';
 ELSE
  new.moderation_reason:=NULL;
 END IF;
 RETURN new;
END $check$;
REVOKE ALL ON FUNCTION private.classify_comment_for_review() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS classify_comment_for_review ON public.comments;
CREATE TRIGGER classify_comment_for_review BEFORE INSERT ON public.comments
 FOR EACH ROW EXECUTE FUNCTION private.classify_comment_for_review();

CREATE OR REPLACE FUNCTION private.record_comment_automod_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $flag$
BEGIN
 IF new.automod_score>=35 THEN
  INSERT INTO public.moderation_automated_flags(target_type,target_id,risk_score,signals)
   VALUES('comment',new.id,new.automod_score,new.automod_signals)
   ON CONFLICT(target_type,target_id) DO UPDATE
    SET risk_score=greatest(moderation_automated_flags.risk_score,excluded.risk_score),
    signals=excluded.signals,updated_at=now();
 END IF;
 RETURN new;
END $flag$;
REVOKE ALL ON FUNCTION private.record_comment_automod_flag() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS record_comment_automod_flag ON public.comments;
CREATE TRIGGER record_comment_automod_flag AFTER INSERT ON public.comments
 FOR EACH ROW EXECUTE FUNCTION private.record_comment_automod_flag();

CREATE OR REPLACE FUNCTION private.rate_limit_report_inserts()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $report$
BEGIN
 IF current_setting('role',true)='service_role' THEN RETURN new;END IF;
 IF auth.uid() IS NULL OR new.reporter_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'Sign in before reporting content' USING ERRCODE='42501';END IF;
 IF length(btrim(coalesce(new.reason,''))) NOT BETWEEN 8 AND 500 THEN
  RAISE EXCEPTION 'Describe the report in 8 to 500 characters' USING ERRCODE='22023';END IF;
 IF (SELECT count(*) FROM public.content_reports
    WHERE reporter_id=auth.uid() AND created_at>now()-interval '24 hours')>=15 THEN
  RAISE EXCEPTION 'Daily reporting limit reached' USING ERRCODE='22023';END IF;
 IF new.content_type='direct_message' AND NOT EXISTS(
    SELECT 1 FROM public.direct_messages d WHERE d.id=new.content_id
      AND auth.uid() IN (d.sender_id,d.recipient_id)) THEN
  RAISE EXCEPTION 'You must be a participant to report this message' USING ERRCODE='42501';END IF;
 IF new.status IS DISTINCT FROM 'open' OR new.resolved_at IS NOT NULL
    OR new.resolved_by IS NOT NULL THEN
  RAISE EXCEPTION 'New reports must start open' USING ERRCODE='22023';END IF;
 RETURN new;
END $report$;
REVOKE ALL ON FUNCTION private.rate_limit_report_inserts() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS rate_limit_report_inserts ON public.content_reports;
CREATE TRIGGER rate_limit_report_inserts BEFORE INSERT ON public.content_reports
 FOR EACH ROW EXECUTE FUNCTION private.rate_limit_report_inserts();

CREATE OR REPLACE FUNCTION private.group_mass_reports_for_review()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $mass$
DECLARE unique_reporters integer:=0;v_score integer;
BEGIN
 IF new.reporter_id IS NULL OR new.content_type='direct_message' THEN RETURN new; END IF;
 SELECT count(distinct r.reporter_id) INTO unique_reporters FROM public.content_reports r
 WHERE r.content_type=new.content_type AND r.content_id=new.content_id
   AND r.reporter_id IS NOT NULL AND r.created_at>now()-interval '24 hours';
 IF unique_reporters>=4 THEN
  v_score:=least(100,55+(unique_reporters-4)*10);
  INSERT INTO public.moderation_automated_flags(target_type,target_id,risk_score,signals)
   VALUES(new.content_type,new.content_id,v_score,ARRAY['multiple_independent_reports'])
   ON CONFLICT(target_type,target_id) DO UPDATE SET
    risk_score=greatest(moderation_automated_flags.risk_score,excluded.risk_score),
    signals=CASE WHEN 'multiple_independent_reports'=ANY(moderation_automated_flags.signals)
      THEN moderation_automated_flags.signals
      ELSE array_append(moderation_automated_flags.signals,'multiple_independent_reports') END,
    updated_at=now();
 END IF;
 -- High report volume creates one review flag; it NEVER automatically bans,
 -- deletes, or hides content. Protect against coordinated false reporting.
 RETURN new;
END $mass$;
REVOKE ALL ON FUNCTION private.group_mass_reports_for_review() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS group_mass_reports_for_review ON public.content_reports;
CREATE TRIGGER group_mass_reports_for_review AFTER INSERT ON public.content_reports
 FOR EACH ROW EXECUTE FUNCTION private.group_mass_reports_for_review();

CREATE OR REPLACE FUNCTION private.alert_staff_to_automod_flag()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $alerts$
DECLARE staff record;
BEGIN
 IF new.risk_score<55 THEN RETURN new;END IF;
 FOR staff IN SELECT id FROM public.profiles
  WHERE role IN ('super','admin') AND account_status='active' ORDER BY created_at LIMIT 5
 LOOP
  PERFORM public.emit_user_notification(staff.id,'moderation_review',
   'New safety review needed','A potentially harmful item has been queued for review.',
   '/moderator/dashboard.html?tab=reports',
   jsonb_build_object('flag_id',new.id,'target_type',new.target_type));
 END LOOP;
 RETURN new;
END $alerts$;
REVOKE ALL ON FUNCTION private.alert_staff_to_automod_flag() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS alert_staff_to_automod_flag ON public.moderation_automated_flags;
CREATE TRIGGER alert_staff_to_automod_flag AFTER INSERT ON public.moderation_automated_flags
 FOR EACH ROW EXECUTE FUNCTION private.alert_staff_to_automod_flag();

-- Community submissions also hold clear direct-threat phrases for review.
CREATE OR REPLACE FUNCTION public.forum_automod_reason(p_body text,p_rules text[],p_actor uuid,p_table text)
RETURNS text LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $community$
DECLARE v_links integer;v_word text;v_duplicate boolean;
BEGIN
 IF coalesce(p_body,'') ~* '(kill yourself|i will kill you|i am going to hurt you|i will hurt you)' THEN
  RETURN 'Possible direct threat: moderator review required'; END IF;
 IF length(coalesce(p_body,''))>8000 THEN RETURN 'Long post needs a review';END IF;
 SELECT count(*) INTO v_links FROM regexp_matches(coalesce(p_body,''),'https?://','gi');
 IF v_links>=3 THEN RETURN 'Multiple external links';END IF;
 FOREACH v_word IN ARRAY coalesce(p_rules,ARRAY[]::text[]) LOOP
  IF length(btrim(v_word))>=3 AND position(lower(btrim(v_word)) IN lower(coalesce(p_body,'')))>0
   THEN RETURN 'Community prohibited phrase'; END IF;
 END LOOP;
 IF p_table='thread' THEN
  SELECT EXISTS(SELECT 1 FROM public.community_threads t
   WHERE t.author_id=p_actor AND t.created_at>now()-interval '15 minutes'
     AND lower(btrim(t.body))=lower(btrim(coalesce(p_body,''))) AND length(btrim(t.body))>25)
  INTO v_duplicate;
 ELSE
  SELECT EXISTS(SELECT 1 FROM public.discussion_messages m
   WHERE m.author_id=p_actor AND m.created_at>now()-interval '10 minutes'
     AND lower(btrim(m.body))=lower(btrim(coalesce(p_body,''))) AND length(btrim(m.body))>25)
  INTO v_duplicate;
 END IF;
 IF v_duplicate THEN RETURN 'Repeated identical content';END IF;
 RETURN NULL;
END $community$;
NOTIFY pgrst,'reload schema';
