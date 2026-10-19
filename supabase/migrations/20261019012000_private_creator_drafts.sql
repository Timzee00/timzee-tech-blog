-- Private cross-device creator drafts. Publication still uses the existing
-- community thread form and moderation rules, never a privileged shortcut.
CREATE TABLE IF NOT EXISTS public.creator_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 kind text NOT NULL DEFAULT 'discussion'
  CHECK (kind IN ('discussion','question','guide','news','showcase','video-script')),
 title text NOT NULL DEFAULT '' CHECK (char_length(title)<=180),
 body text NOT NULL DEFAULT '' CHECK (char_length(body)<=12000),
 community_id uuid REFERENCES public.discussion_topics(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS creator_drafts_owner_recent
 ON public.creator_drafts(user_id,updated_at DESC,id);
ALTER TABLE public.creator_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.creator_drafts FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE,DELETE ON public.creator_drafts TO authenticated;
CREATE POLICY creator_drafts_select_owner ON public.creator_drafts FOR SELECT
 TO authenticated USING (user_id=(SELECT auth.uid()));
CREATE POLICY creator_drafts_insert_owner ON public.creator_drafts FOR INSERT
 TO authenticated WITH CHECK (user_id=(SELECT auth.uid()));
CREATE POLICY creator_drafts_update_owner ON public.creator_drafts FOR UPDATE
 TO authenticated USING (user_id=(SELECT auth.uid()))
 WITH CHECK (user_id=(SELECT auth.uid()));
CREATE POLICY creator_drafts_delete_owner ON public.creator_drafts FOR DELETE
 TO authenticated USING (user_id=(SELECT auth.uid()));

CREATE OR REPLACE FUNCTION public.creator_draft_write_guard()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public
AS $draft$
DECLARE v_limit integer:=5;v_count integer:=0;v_tier text;v_verified boolean;
BEGIN
 IF TG_OP='UPDATE' AND new.user_id IS DISTINCT FROM old.user_id THEN
  RAISE EXCEPTION 'Draft ownership cannot change' USING ERRCODE='42501';
 END IF;
 IF TG_OP='INSERT' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(new.user_id::text,810211));
  SELECT coalesce(p.is_verified,false)
    AND(p.verification_expires_at IS NULL OR p.verification_expires_at>now()),
    p.verification_tier
   INTO v_verified,v_tier FROM public.profiles p WHERE p.id=new.user_id;
  IF coalesce(v_verified,false) THEN
   v_limit:=CASE lower(coalesce(v_tier,''))
    WHEN 'silver' THEN 25 WHEN 'gold' THEN 100
    WHEN 'platinum' THEN 250 WHEN 'business' THEN 100 ELSE 5 END;
  END IF;
  SELECT count(*) INTO v_count FROM public.creator_drafts WHERE user_id=new.user_id;
  IF v_count>=v_limit THEN
   RAISE EXCEPTION 'Your saved draft limit is %. Remove an unused draft before saving another.',v_limit USING ERRCODE='22023';
  END IF;
 END IF;
 new.updated_at:=now();
 RETURN new;
END
$draft$;
DROP TRIGGER IF EXISTS creator_draft_write_guard_trigger ON public.creator_drafts;
CREATE TRIGGER creator_draft_write_guard_trigger BEFORE INSERT OR UPDATE
 ON public.creator_drafts FOR EACH ROW EXECUTE FUNCTION public.creator_draft_write_guard();
REVOKE ALL ON FUNCTION public.creator_draft_write_guard() FROM PUBLIC,anon,authenticated;
