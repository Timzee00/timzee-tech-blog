-- Applied to the connected Supabase production project as migration
-- 20261027144147_blipmood_community_rules.
-- Community-level rules are additional; the platform-wide Content Policy takes precedence.
ALTER TABLE public.discussion_topics ADD COLUMN IF NOT EXISTS rules_updated_at timestamptz;
ALTER TABLE public.discussion_topics DROP CONSTRAINT IF EXISTS community_rules_length;
ALTER TABLE public.discussion_topics ADD CONSTRAINT community_rules_length CHECK(char_length(rules)<=1500);

CREATE TABLE IF NOT EXISTS public.community_rule_history(
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  community_id uuid NOT NULL REFERENCES public.discussion_topics(id) ON DELETE CASCADE,
  changed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_rules text NOT NULL,
  new_rules text NOT NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS community_rule_history_community_idx
 ON public.community_rule_history(community_id,changed_at DESC);
ALTER TABLE public.community_rule_history ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.community_rule_history FROM anon,authenticated;
GRANT SELECT ON public.community_rule_history TO authenticated;
DROP POLICY IF EXISTS community_rule_history_staff_read ON public.community_rule_history;
CREATE POLICY community_rule_history_staff_read ON public.community_rule_history
 FOR SELECT TO authenticated USING (
 public.community_is_moderator(community_id,(SELECT auth.uid())) OR
 EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=(SELECT auth.uid())
   AND p.role IN ('admin','super')
   AND coalesce(p.account_status,'active') NOT IN ('banned','suspended'))
);

CREATE OR REPLACE FUNCTION public.community_rules_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $body$
DECLARE v_rules text;
BEGIN
 v_rules:=btrim(replace(coalesce(NEW.rules,''),E'\r',''));
 IF char_length(v_rules)>1500 THEN
   RAISE EXCEPTION 'Community rules must not exceed 1500 characters' USING ERRCODE='22023';
 END IF;
 IF coalesce(array_length(string_to_array(v_rules,E'\n'),1),0)>10 THEN
   RAISE EXCEPTION 'Add no more than ten community rules (one per line)' USING ERRCODE='22023';
 END IF;
 NEW.rules:=v_rules;
 IF TG_OP='INSERT' OR NEW.rules IS DISTINCT FROM OLD.rules THEN
   NEW.rules_updated_at:=now();
 END IF;
 RETURN NEW;
END $body$;
REVOKE ALL ON FUNCTION public.community_rules_guard() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS community_rules_guard_trigger ON public.discussion_topics;
CREATE TRIGGER community_rules_guard_trigger BEFORE INSERT OR UPDATE OF rules
 ON public.discussion_topics FOR EACH ROW EXECUTE FUNCTION public.community_rules_guard();

CREATE OR REPLACE FUNCTION public.community_rules_audit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
BEGIN
 IF OLD.rules IS DISTINCT FROM NEW.rules THEN
   INSERT INTO public.community_rule_history(community_id,changed_by,previous_rules,new_rules)
   VALUES(NEW.id,auth.uid(),OLD.rules,NEW.rules);
 END IF;
 RETURN NEW;
END $body$;
REVOKE ALL ON FUNCTION public.community_rules_audit() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS community_rules_audit_trigger ON public.discussion_topics;
CREATE TRIGGER community_rules_audit_trigger AFTER UPDATE OF rules
 ON public.discussion_topics FOR EACH ROW EXECUTE FUNCTION public.community_rules_audit();

CREATE OR REPLACE FUNCTION public.community_update_rules(p_community uuid,p_rules text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $body$
DECLARE
 v_actor uuid:=auth.uid();
 v_rules text:=btrim(replace(coalesce(p_rules,''),E'\r',''));
 v_saved text;
BEGIN
 IF v_actor IS NULL THEN
  RAISE EXCEPTION 'Sign in to manage community rules' USING ERRCODE='42501';
 END IF;
 IF char_length(v_rules)>1500
    OR coalesce(array_length(string_to_array(v_rules,E'\n'),1),0)>10 THEN
  RAISE EXCEPTION 'Use at most ten rules and 1500 characters total' USING ERRCODE='22023';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM public.discussion_topics c
   WHERE c.id=p_community AND c.community_state='active') THEN
  RAISE EXCEPTION 'Community is not available for editing' USING ERRCODE='22023';
 END IF;
 IF EXISTS(SELECT 1 FROM public.profiles p WHERE p.id=v_actor
   AND coalesce(p.account_status,'active') IN ('banned','suspended')) THEN
  RAISE EXCEPTION 'Your account cannot edit community rules' USING ERRCODE='42501';
 END IF;
 IF NOT (
   EXISTS(SELECT 1 FROM public.community_members cm
    WHERE cm.community_id=p_community AND cm.user_id=v_actor
     AND cm.role IN ('owner','moderator'))
   OR EXISTS(SELECT 1 FROM public.profiles p
    WHERE p.id=v_actor AND p.role IN ('admin','super'))
 ) THEN
  RAISE EXCEPTION 'Community owner or moderator required' USING ERRCODE='42501';
 END IF;
 UPDATE public.discussion_topics SET rules=v_rules WHERE id=p_community
  RETURNING rules INTO v_saved;
 RETURN v_saved;
END $body$;
REVOKE ALL ON FUNCTION public.community_update_rules(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.community_update_rules(uuid,text) TO authenticated;
