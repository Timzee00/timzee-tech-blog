-- Owner-scoped recoverable bin for private creator drafts.
ALTER TABLE public.creator_drafts ADD COLUMN IF NOT EXISTS deleted_at timestamptz;
CREATE INDEX IF NOT EXISTS creator_drafts_bin_cleanup ON public.creator_drafts(deleted_at) WHERE deleted_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.creator_draft_write_guard()
 RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public
AS $draft$
DECLARE v_limit integer:=5;v_count integer:=0;v_tier text;v_verified boolean;
BEGIN
 IF TG_OP='UPDATE' AND new.user_id IS DISTINCT FROM old.user_id THEN
  RAISE EXCEPTION 'Draft ownership cannot change' USING ERRCODE='42501';
 END IF;
 IF TG_OP='INSERT' OR (TG_OP='UPDATE' AND old.deleted_at IS NOT NULL AND new.deleted_at IS NULL) THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(new.user_id::text,810211));
  SELECT coalesce(p.is_verified,false) AND (p.verification_expires_at IS NULL OR p.verification_expires_at>now()),p.verification_tier
   INTO v_verified,v_tier FROM public.profiles p WHERE p.id=new.user_id;
  IF coalesce(v_verified,false) THEN
   v_limit:=CASE lower(coalesce(v_tier,'')) WHEN 'silver' THEN 25 WHEN 'gold' THEN 100
    WHEN 'platinum' THEN 250 WHEN 'business' THEN 100 ELSE 5 END;
  END IF;
  SELECT count(*) INTO v_count FROM public.creator_drafts
   WHERE user_id=new.user_id AND deleted_at IS NULL
   AND (TG_OP='INSERT' OR id<>new.id);
  IF v_count>=v_limit THEN
   RAISE EXCEPTION 'Your saved draft limit is %. Move an unused draft to the bin before adding more.',v_limit USING ERRCODE='22023';
  END IF;
 END IF;
 new.updated_at:=now();
 RETURN new;
END
$draft$;
REVOKE ALL ON FUNCTION public.creator_draft_write_guard() FROM PUBLIC,anon,authenticated;

CREATE OR REPLACE FUNCTION private.process_creator_draft_retention()
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public,private AS $retention$
DECLARE v_archived integer:=0;v_deleted integer:=0;
BEGIN
 WITH overdue AS (
  SELECT id FROM public.creator_drafts WHERE deleted_at IS NOT NULL
   AND deleted_at<=now()-interval '30 days'
  ORDER BY deleted_at,id LIMIT 500 FOR UPDATE SKIP LOCKED
 )
 DELETE FROM public.creator_drafts d USING overdue q WHERE d.id=q.id;
 GET DIAGNOSTICS v_deleted=ROW_COUNT;
 WITH inactive AS (
  SELECT id FROM public.creator_drafts WHERE deleted_at IS NULL
   AND updated_at<=now()-interval '7 days'
  ORDER BY updated_at,id LIMIT 500 FOR UPDATE SKIP LOCKED
 )
 UPDATE public.creator_drafts d SET deleted_at=now(),updated_at=now()
 FROM inactive q WHERE d.id=q.id;
 GET DIAGNOSTICS v_archived=ROW_COUNT;
 RETURN jsonb_build_object('archived',v_archived,'deleted',v_deleted);
END
$retention$;
REVOKE ALL ON FUNCTION private.process_creator_draft_retention() FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION private.process_creator_draft_retention() TO postgres;
SELECT cron.schedule('timzee-creator-draft-retention-daily','11 3 * * *',
 'SELECT private.process_creator_draft_retention()');
