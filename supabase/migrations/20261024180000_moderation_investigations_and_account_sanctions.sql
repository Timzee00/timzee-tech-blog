
-- Investigative moderation: auditable case notes, proportionate sanctions,
-- reporter outcomes, reversible suspensions and strict database permissions.
ALTER TABLE public.content_reports ADD COLUMN IF NOT EXISTS investigation_state text NOT NULL DEFAULT 'new';
ALTER TABLE public.content_reports DROP CONSTRAINT IF EXISTS content_reports_investigation_state_check;
ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_investigation_state_check
 CHECK(investigation_state IN ('new','investigating','closed'));

-- Do not let an authenticated browser finalize a complaint without the server audit.
DROP POLICY IF EXISTS "Reports update mods" ON public.content_reports;
REVOKE ALL ON public.content_reports FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.content_reports TO authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.content_reports TO service_role;
DROP POLICY IF EXISTS "Reports read reporter" ON public.content_reports;
CREATE POLICY "Reports read reporter" ON public.content_reports FOR SELECT TO authenticated
 USING(reporter_id=(select auth.uid()));
CREATE INDEX IF NOT EXISTS content_reports_grouped_active ON public.content_reports
(content_type,content_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS content_reports_reporter_history ON public.content_reports(reporter_id,created_at DESC);

CREATE TABLE IF NOT EXISTS public.moderation_case_notes(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 report_id uuid NOT NULL REFERENCES public.content_reports(id) ON DELETE CASCADE,
 reviewer_id uuid NOT NULL REFERENCES auth.users(id),
 outcome text NOT NULL CHECK(outcome IN ('investigating','confirmed','dismissed')),
 action text NOT NULL CHECK(action IN ('none','warn','hide','suspend_24h','suspend_7d','ban')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 20 AND 2000),
 evidence_summary text NOT NULL CHECK(length(btrim(evidence_summary)) BETWEEN 20 AND 2000),
 subject_id uuid,
 request_id uuid NOT NULL UNIQUE,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS moderation_case_notes_report_idx ON public.moderation_case_notes(report_id,created_at DESC);
ALTER TABLE public.moderation_case_notes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moderation_case_notes FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.moderation_case_notes TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.moderation_case_notes_id_seq TO service_role;

CREATE TABLE IF NOT EXISTS public.moderation_account_actions(
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 report_id uuid REFERENCES public.content_reports(id) ON DELETE SET NULL,
 target_id uuid NOT NULL REFERENCES auth.users(id),
 actor_id uuid NOT NULL REFERENCES auth.users(id),
 action text NOT NULL CHECK(action IN ('warn','suspend_24h','suspend_7d','ban','reinstate')),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 20 AND 2000),
 ends_at timestamptz,
 lifted_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((action IN ('suspend_24h','suspend_7d') AND ends_at IS NOT NULL)
        OR (action NOT IN ('suspend_24h','suspend_7d') AND ends_at IS NULL))
);
CREATE INDEX IF NOT EXISTS moderation_account_actions_active_idx
 ON public.moderation_account_actions(target_id,created_at DESC) WHERE lifted_at IS NULL;
ALTER TABLE public.moderation_account_actions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.moderation_account_actions FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.moderation_account_actions TO service_role;
GRANT USAGE,SELECT ON SEQUENCE public.moderation_account_actions_id_seq TO service_role;

CREATE OR REPLACE FUNCTION public.staff_decide_content_report(
 p_actor uuid,p_report uuid,p_outcome text,p_action text,
 p_reason text,p_evidence text,p_request uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $moderation$
DECLARE
 v_role text;v_case public.content_reports%ROWTYPE;
 v_subject uuid;v_other uuid;v_subject_role text;v_subject_status text;
 v_note_id bigint;v_audit_id bigint;v_ends timestamptz;v_new_status text;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role' THEN
  RAISE EXCEPTION 'Server-only moderation' USING ERRCODE='42501';
 END IF;
 IF p_actor IS NULL OR p_report IS NULL OR p_request IS NULL OR
  p_outcome NOT IN ('investigating','confirmed','dismissed') OR
  p_action NOT IN ('none','warn','hide','suspend_24h','suspend_7d','ban') OR
  length(btrim(coalesce(p_reason,''))) NOT BETWEEN 20 AND 2000 OR
  length(btrim(coalesce(p_evidence,''))) NOT BETWEEN 20 AND 2000 THEN
  RAISE EXCEPTION 'A decision requires a written rationale and evidence review' USING ERRCODE='22023';
 END IF;
 SELECT lower(coalesce(role,'user')) INTO v_role FROM public.profiles
  WHERE id=p_actor AND account_status='active' FOR SHARE;
 IF v_role NOT IN ('moderator','admin','super') OR v_role IS NULL THEN
  RAISE EXCEPTION 'Moderator is no longer authorized' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(p_report::text,180024));
 SELECT * INTO v_case FROM public.content_reports WHERE id=p_report FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Report unavailable' USING ERRCODE='P0002'; END IF;
 SELECT id INTO v_note_id FROM public.moderation_case_notes WHERE request_id=p_request;
 IF FOUND THEN
  IF NOT EXISTS(SELECT 1 FROM public.moderation_case_notes
     WHERE id=v_note_id AND report_id=p_report AND reviewer_id=p_actor
     AND outcome=p_outcome AND action=p_action AND reason=btrim(p_reason)
     AND evidence_summary=btrim(p_evidence)) THEN
    RAISE EXCEPTION 'Request identifier already used differently' USING ERRCODE='23505';
  END IF;
  RETURN jsonb_build_object('ok',true,'replayed',true,'noteId',v_note_id);
 END IF;
 IF v_case.status IS DISTINCT FROM 'open' THEN
  RAISE EXCEPTION 'This report is already closed' USING ERRCODE='23505';
 END IF;
 IF (p_outcome IN ('investigating','dismissed') AND p_action<>'none') THEN
  RAISE EXCEPTION 'Investigation or dismissal cannot punish a user' USING ERRCODE='22023';
 END IF;
 -- Link an actionable user to verified server-side evidence, not browser input.
 CASE v_case.content_type
 WHEN 'user','profile' THEN
  SELECT id INTO v_subject FROM public.profiles WHERE id=v_case.content_id;
 WHEN 'post','posts' THEN
  SELECT author_id INTO v_subject FROM public.posts WHERE id=v_case.content_id;
 WHEN 'comment','comments' THEN
  SELECT author_id INTO v_subject FROM public.comments WHERE id=v_case.content_id;
 WHEN 'discussion_message' THEN
  SELECT author_id INTO v_subject FROM public.discussion_messages WHERE id=v_case.content_id;
 WHEN 'marketplace_item' THEN
  SELECT user_id INTO v_subject FROM public.marketplace_items WHERE id=v_case.content_id;
 WHEN 'video' THEN
  SELECT user_id INTO v_subject FROM public.videos WHERE id=v_case.content_id;
 WHEN 'novel' THEN
  SELECT author_id INTO v_subject FROM public.novels WHERE id=v_case.content_id;
 WHEN 'direct_message' THEN
  SELECT sender_id,recipient_id INTO v_subject,v_other
  FROM public.direct_messages WHERE id=v_case.content_id;
  IF v_case.reporter_id IS DISTINCT FROM v_other THEN v_subject:=NULL; END IF;
 ELSE v_subject:=NULL;
 END CASE;
 IF p_action<>'none' AND v_subject IS NULL THEN
  RAISE EXCEPTION 'Reported target is unavailable or sanction is unsupported' USING ERRCODE='22023';
 END IF;
 IF p_action IN ('warn','suspend_24h','suspend_7d','ban') THEN
  IF v_subject IS NOT DISTINCT FROM p_actor THEN
   RAISE EXCEPTION 'Staff cannot sanction themselves' USING ERRCODE='42501';
  END IF;
  SELECT lower(coalesce(role,'user')),account_status
  INTO v_subject_role,v_subject_status
  FROM public.profiles WHERE id=v_subject FOR UPDATE;
  -- Never let a moderator or admin ban another staff member.
  IF v_subject_role IS DISTINCT FROM 'user' THEN
   RAISE EXCEPTION 'Staff accounts require a separate founder review' USING ERRCODE='42501';
  END IF;
  IF v_subject_status NOT IN ('active','suspended') THEN
   RAISE EXCEPTION 'The account is already restricted' USING ERRCODE='22023';
  END IF;
 END IF;
 IF p_outcome='confirmed' AND p_action='hide' THEN
  CASE v_case.content_type
  WHEN 'comment','comments' THEN
   UPDATE public.comments SET status='pending' WHERE id=v_case.content_id;
  WHEN 'post','posts' THEN
   UPDATE public.posts SET status='draft' WHERE id=v_case.content_id;
  WHEN 'discussion_message' THEN
   UPDATE public.discussion_messages SET moderation_status='pending' WHERE id=v_case.content_id;
  WHEN 'marketplace_item' THEN
   UPDATE public.marketplace_items SET is_available=false WHERE id=v_case.content_id;
  WHEN 'video' THEN
   UPDATE public.videos SET is_public=false WHERE id=v_case.content_id;
  ELSE
   RAISE EXCEPTION 'This report cannot hide that content type' USING ERRCODE='22023';
  END CASE;
 END IF;
 IF p_outcome='confirmed' AND p_action IN ('warn','suspend_24h','suspend_7d','ban') THEN
  IF p_action='suspend_24h' THEN v_ends:=now()+interval '24 hours';
  ELSIF p_action='suspend_7d' THEN v_ends:=now()+interval '7 days'; END IF;
  -- Escalation replaces an existing active restriction without destroying its audit.
  UPDATE public.moderation_account_actions SET lifted_at=now()
   WHERE target_id=v_subject AND lifted_at IS NULL AND action IN ('suspend_24h','suspend_7d','ban');
  INSERT INTO public.moderation_account_actions(report_id,target_id,actor_id,action,reason,ends_at)
   VALUES(p_report,v_subject,p_actor,p_action,btrim(p_reason),v_ends);
  IF p_action IN ('suspend_24h','suspend_7d','ban') THEN
   UPDATE public.profiles SET account_status=
     CASE WHEN p_action='ban' THEN 'banned' ELSE 'suspended' END
     WHERE id=v_subject;
  END IF;
  PERFORM public.emit_user_notification(v_subject,'account_moderation',
   'Account moderation decision',
   CASE p_action WHEN 'warn' THEN 'Your account has received a warning. Review the community rules.'
    WHEN 'ban' THEN 'Your account has been banned. Contact support if you believe this is incorrect.'
    ELSE 'Your account has been temporarily suspended. Contact support to appeal.' END,
   '/support.html',jsonb_build_object('report_id',p_report,'action',p_action));
 END IF;
 IF p_outcome='investigating' THEN
  UPDATE public.content_reports SET investigation_state='investigating' WHERE id=p_report;
 ELSE
  v_new_status:=CASE WHEN p_outcome='confirmed' THEN 'resolved' ELSE 'dismissed' END;
  UPDATE public.content_reports
   SET status=v_new_status,investigation_state='closed',resolved_by=p_actor,resolved_at=now()
   WHERE id=p_report;
 END IF;
 INSERT INTO public.moderation_case_notes
  (report_id,reviewer_id,outcome,action,reason,evidence_summary,subject_id,request_id)
 VALUES (p_report,p_actor,p_outcome,p_action,btrim(p_reason),btrim(p_evidence),v_subject,p_request)
 RETURNING id INTO v_note_id;
 INSERT INTO public.moderation_audit
  (moderator_id,moderator_role,action,content_type,content_id,details,request_id)
 VALUES(p_actor,v_role,'report_'||p_outcome,'content_reports',p_report::text,
  jsonb_build_object('evidence_record',v_note_id,'action',p_action,
   'subject_id',v_subject,'investigation',true),p_request)
 RETURNING id INTO v_audit_id;
 IF v_case.reporter_id IS NOT NULL THEN
  PERFORM public.emit_user_notification(v_case.reporter_id,'report_status',
   'Update on your report',
   CASE p_outcome WHEN 'investigating' THEN 'Your report is being investigated.'
    WHEN 'confirmed' THEN 'Your report was reviewed and action was taken where appropriate.'
    ELSE 'Your report was reviewed and no violation could be confirmed.' END,
   '/profile.html?tab=notifications',
   jsonb_build_object('report_id',p_report,'decision',p_outcome));
 END IF;
 RETURN jsonb_build_object('ok',true,'replayed',false,'noteId',v_note_id,'auditId',v_audit_id,'reportStatus',coalesce(v_new_status,'open'));
END;
$moderation$;
REVOKE ALL ON FUNCTION public.staff_decide_content_report(uuid,uuid,text,text,text,text,uuid)
 FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_decide_content_report(uuid,uuid,text,text,text,text,uuid)
 TO service_role;

CREATE OR REPLACE FUNCTION public.staff_lift_account_restriction(
 p_actor uuid,p_target uuid,p_reason text,p_request uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $lift$
DECLARE v_role text;v_target_role text;v_active bigint;v_audit bigint;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role'
 THEN RAISE EXCEPTION 'Server-only' USING ERRCODE='42501';END IF;
 IF p_actor IS NULL OR p_target IS NULL OR p_request IS NULL
    OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 20 AND 2000
 THEN RAISE EXCEPTION 'Reason and identifiers are required' USING ERRCODE='22023'; END IF;
 SELECT lower(coalesce(role,'user')) INTO v_role
 FROM public.profiles WHERE id=p_actor AND account_status='active' FOR SHARE;
 IF v_role NOT IN ('moderator','admin','super') THEN
  RAISE EXCEPTION 'Moderator unavailable' USING ERRCODE='42501'; END IF;
 IF p_target=p_actor THEN RAISE EXCEPTION 'Self-restoration is prohibited' USING ERRCODE='42501';END IF;
 SELECT lower(coalesce(role,'user')) INTO v_target_role
 FROM public.profiles WHERE id=p_target FOR UPDATE;
 IF v_target_role IS DISTINCT FROM 'user' THEN
  RAISE EXCEPTION 'Only standard accounts can be restored here' USING ERRCODE='42501';END IF;
 SELECT id INTO v_audit FROM public.moderation_audit WHERE request_id=p_request;
 IF FOUND THEN RETURN jsonb_build_object('ok',true,'replayed',true,'auditId',v_audit);END IF;
 SELECT id INTO v_active FROM public.moderation_account_actions
  WHERE target_id=p_target AND lifted_at IS NULL AND action IN ('suspend_24h','suspend_7d','ban')
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'No active suspension or ban' USING ERRCODE='P0002';END IF;
 UPDATE public.moderation_account_actions SET lifted_at=now()
  WHERE id=v_active;
 UPDATE public.profiles SET account_status='active' WHERE id=p_target
  AND account_status IN ('suspended','banned');
 INSERT INTO public.moderation_account_actions(target_id,actor_id,action,reason)
 VALUES(p_target,p_actor,'reinstate',btrim(p_reason));
 INSERT INTO public.moderation_audit
  (moderator_id,moderator_role,action,content_type,content_id,details,request_id)
 VALUES(p_actor,v_role,'reinstate','profiles',p_target::text,
  jsonb_build_object('previous_sanction',v_active,'reason',left(btrim(p_reason),1000)),p_request)
 RETURNING id INTO v_audit;
 PERFORM public.emit_user_notification(p_target,'account_moderation',
 'Account access restored','Your account restriction has been lifted.',
 '/profile.html',jsonb_build_object('restored',true,'audit_id',v_audit));
 RETURN jsonb_build_object('ok',true,'replayed',false,'auditId',v_audit);
END $lift$;
REVOKE ALL ON FUNCTION public.staff_lift_account_restriction(uuid,uuid,text,uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.staff_lift_account_restriction(uuid,uuid,text,uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.expire_moderation_suspensions()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $expire$
DECLARE v_id bigint;v_target uuid;v_count integer:=0;
BEGIN
 IF current_setting('role',true) IS DISTINCT FROM 'service_role'
 THEN RAISE EXCEPTION 'Server-only' USING ERRCODE='42501';END IF;
 FOR v_id,v_target IN
 SELECT a.id,a.target_id FROM public.moderation_account_actions a
 WHERE a.action IN ('suspend_24h','suspend_7d') AND a.lifted_at IS NULL AND a.ends_at<=now()
 ORDER BY a.ends_at ASC LIMIT 100 FOR UPDATE SKIP LOCKED
 LOOP
  UPDATE public.moderation_account_actions SET lifted_at=now() WHERE id=v_id AND lifted_at IS NULL;
  IF NOT EXISTS(SELECT 1 FROM public.moderation_account_actions a
    WHERE a.target_id=v_target AND a.lifted_at IS NULL
      AND a.action IN ('ban','suspend_24h','suspend_7d') AND (a.ends_at IS NULL OR a.ends_at>now()))
  THEN
   UPDATE public.profiles SET account_status='active' WHERE id=v_target AND account_status='suspended';
   IF FOUND THEN
    PERFORM public.emit_user_notification(v_target,'account_moderation',
     'Suspension ended','Your temporary account restriction has ended.',
     '/profile.html',jsonb_build_object('expired_sanction',v_id));
   END IF;
  END IF;
  v_count:=v_count+1;
 END LOOP;
 RETURN v_count;
END $expire$;
REVOKE ALL ON FUNCTION public.expire_moderation_suspensions() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.expire_moderation_suspensions() TO service_role;

-- Enforce suspensions against user-originated content writes even with an
-- existing browser session. Service workers bypass this only with server keys.
CREATE OR REPLACE FUNCTION private.block_restricted_account_writes()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $block$
DECLARE v_uid uuid:=auth.uid();v_status text;
BEGIN
 IF current_setting('role',true)='service_role' THEN RETURN new;END IF;
 IF v_uid IS NULL THEN RETURN new;END IF;
 SELECT account_status INTO v_status FROM public.profiles WHERE id=v_uid;
 IF v_status IS DISTINCT FROM 'active' THEN
  RAISE EXCEPTION 'Account restricted from posting or messaging' USING ERRCODE='42501';
 END IF;
 RETURN new;
END $block$;
REVOKE ALL ON FUNCTION private.block_restricted_account_writes() FROM PUBLIC,anon,authenticated;
DO $triggers$
DECLARE tbl text;
BEGIN
 FOREACH tbl IN ARRAY ARRAY['posts','comments','direct_messages','community_threads','discussion_messages','marketplace_items','videos'] LOOP
  EXECUTE format('DROP TRIGGER IF EXISTS moderation_account_write_guard ON public.%I',tbl);
  EXECUTE format('CREATE TRIGGER moderation_account_write_guard BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION private.block_restricted_account_writes()',tbl);
 END LOOP;
END $triggers$;
NOTIFY pgrst,'reload schema';
