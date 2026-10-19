-- Reviewed/dismissed moderation cases are immutable until an explicit,
-- separately audited appeal workflow exists. Existing RPCs previously allowed
-- silently rewriting resolution timestamps and reviewer identities.
CREATE OR REPLACE FUNCTION private.guard_finalized_community_review()
RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path=pg_catalog,public
AS $function$
BEGIN
 IF TG_TABLE_NAME='community_reports' THEN
   IF OLD.status<>'pending' THEN
     RAISE EXCEPTION 'This community report has already been reviewed'
       USING ERRCODE='22023';
   END IF;
   IF NEW.status NOT IN ('reviewed','dismissed') THEN
     RAISE EXCEPTION 'Invalid report review state' USING ERRCODE='22023';
   END IF;
 ELSE
   IF OLD.state<>'pending' THEN
     RAISE EXCEPTION 'This spam signal has already been reviewed'
       USING ERRCODE='22023';
   END IF;
   IF NEW.state NOT IN ('reviewed','dismissed') THEN
     RAISE EXCEPTION 'Invalid spam review state' USING ERRCODE='22023';
   END IF;
 END IF;
 RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION private.guard_finalized_community_review()
 FROM PUBLIC,anon,authenticated;

DROP TRIGGER IF EXISTS guard_finalized_community_report ON public.community_reports;
CREATE TRIGGER guard_finalized_community_report
BEFORE UPDATE OF status ON public.community_reports
FOR EACH ROW EXECUTE FUNCTION private.guard_finalized_community_review();

DROP TRIGGER IF EXISTS guard_finalized_auto_flag ON public.community_auto_moderation;
CREATE TRIGGER guard_finalized_auto_flag
BEFORE UPDATE OF state ON public.community_auto_moderation
FOR EACH ROW EXECUTE FUNCTION private.guard_finalized_community_review();
