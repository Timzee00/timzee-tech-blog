-- Founder Operations Brain: ordered partial indexes for global staff queues,
-- plus transactionally complete audit records for community review decisions.
-- Do not grant any new moderation privilege; existing secured RPCs remain authoritative.
CREATE INDEX IF NOT EXISTS content_reports_open_triage_idx
 ON public.content_reports(created_at ASC,id) WHERE status='open';
CREATE INDEX IF NOT EXISTS community_reports_pending_triage_idx
 ON public.community_reports(created_at ASC,id) WHERE status='pending';
CREATE INDEX IF NOT EXISTS community_auto_moderation_pending_triage_idx
 ON public.community_auto_moderation(risk_score DESC,created_at ASC,id)
 WHERE state='pending';

CREATE OR REPLACE FUNCTION private.audit_founder_community_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path=pg_catalog,public
AS $function$
DECLARE
 v_actor uuid;
 v_role text;
 v_decision text;
 v_type text;
 v_target text;
 v_board uuid;
BEGIN
 IF TG_TABLE_NAME='community_reports' THEN
   IF OLD.status IS NOT DISTINCT FROM NEW.status OR OLD.status<>'pending'
      OR NEW.status NOT IN ('reviewed','dismissed') THEN RETURN NEW; END IF;
   v_actor:=NEW.resolved_by;
   v_decision:=NEW.status;
   v_type:='community_report';
   v_target:=NEW.id::text;
   v_board:=NEW.community_id;
 ELSE
   IF OLD.state IS NOT DISTINCT FROM NEW.state OR OLD.state<>'pending'
      OR NEW.state NOT IN ('reviewed','dismissed') THEN RETURN NEW; END IF;
   v_actor:=NEW.reviewed_by;
   v_decision:=NEW.state;
   v_type:='community_auto_flag';
   v_target:=NEW.id::text;
   v_board:=NEW.community_id;
 END IF;
 -- Fails closed if a review lacks a real authenticated actor.
 IF v_actor IS NULL OR v_actor IS DISTINCT FROM auth.uid() THEN
   RAISE EXCEPTION 'Authenticated reviewer is required' USING ERRCODE='42501';
 END IF;
 SELECT p.role INTO v_role FROM public.profiles p WHERE p.id=v_actor;
 INSERT INTO public.moderation_audit
   (moderator_id,moderator_role,action,content_type,content_id,details,created_at)
 VALUES
   (v_actor,coalesce(v_role,'community_moderator'),
    'community_'||v_decision,v_type,v_target,
    jsonb_build_object('community_id',v_board,'review_kind',v_type),now());
 RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.audit_founder_community_review()
 FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS audit_founder_community_report_review ON public.community_reports;
CREATE TRIGGER audit_founder_community_report_review
AFTER UPDATE OF status ON public.community_reports
FOR EACH ROW EXECUTE FUNCTION private.audit_founder_community_review();

DROP TRIGGER IF EXISTS audit_founder_automod_review ON public.community_auto_moderation;
CREATE TRIGGER audit_founder_automod_review
AFTER UPDATE OF state ON public.community_auto_moderation
FOR EACH ROW EXECUTE FUNCTION private.audit_founder_community_review();
