
-- Verification applications must not grant themselves a badge or store base64 IDs.
INSERT INTO storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
VALUES('verification-proofs','verification-proofs',false,5242880,
 ARRAY['application/pdf','image/jpeg','image/png'])
ON CONFLICT(id) DO UPDATE SET public=false,file_size_limit=5242880,
 allowed_mime_types=EXCLUDED.allowed_mime_types;
DROP POLICY IF EXISTS proof_upload_owner ON storage.objects;
CREATE POLICY proof_upload_owner ON storage.objects FOR INSERT TO authenticated
WITH CHECK(bucket_id='verification-proofs' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);
DROP POLICY IF EXISTS proof_read_owner_staff ON storage.objects;
CREATE POLICY proof_read_owner_staff ON storage.objects FOR SELECT TO authenticated
USING(bucket_id='verification-proofs' AND (
 (storage.foldername(name))[1]=(SELECT auth.uid())::text
 OR coalesce(public.has_role_secure('admin'),false)
 OR coalesce(public.has_role_secure('super'),false)));
DROP POLICY IF EXISTS proof_delete_owner ON storage.objects;
CREATE POLICY proof_delete_owner ON storage.objects FOR DELETE TO authenticated
USING(bucket_id='verification-proofs' AND (storage.foldername(name))[1]=(SELECT auth.uid())::text);

CREATE UNIQUE INDEX IF NOT EXISTS one_pending_verification_per_user
 ON public.verification_applications(user_id) WHERE status='pending';

CREATE OR REPLACE FUNCTION public.guard_verification_application()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v_file jsonb;v_path text;v_doc_type text;v_counter integer:=0;
BEGIN
 IF auth.uid() IS NULL OR new.user_id IS DISTINCT FROM auth.uid() THEN
  RAISE EXCEPTION 'A verified login is required to apply' USING ERRCODE='42501';
 END IF;
 IF new.verification_type NOT IN ('silver','gold','platinum','business','creator') THEN
  RAISE EXCEPTION 'Unknown verification application type' USING ERRCODE='22023';
 END IF;
 IF length(btrim(coalesce(new.message,''))) NOT BETWEEN 20 AND 2500 THEN
  RAISE EXCEPTION 'Explain your request in 20–2500 characters' USING ERRCODE='22023';
 END IF;
 IF new.documents IS NULL THEN new.documents:='[]'::jsonb; END IF;
 IF jsonb_typeof(new.documents)<>'array' OR jsonb_array_length(new.documents)>5 THEN
  RAISE EXCEPTION 'Only up to five secure verification documents are permitted' USING ERRCODE='22023';
 END IF;
 FOR v_file IN SELECT value FROM jsonb_array_elements(new.documents) LOOP
  v_counter:=v_counter+1;
  v_path:=v_file->>'path';v_doc_type:=v_file->>'type';
  IF v_path IS NULL OR v_path NOT LIKE auth.uid()::text||'/%'
   OR v_path LIKE '%..%' OR v_path ~ '[?#]'
   OR length(v_path)>230 OR
   v_doc_type NOT IN ('application/pdf','image/jpeg','image/png')
   OR NOT v_path ~* '\.(pdf|jpe?g|png)$' THEN
    RAISE EXCEPTION 'Verification evidence must use your private uploads' USING ERRCODE='42501';
  END IF;
 END LOOP;
 SELECT u.email INTO new.user_email FROM auth.users u WHERE u.id=auth.uid();
 SELECT coalesce(nullif(btrim(p.display_name),''),'Member')
  INTO new.user_name FROM public.profiles p WHERE p.id=auth.uid();
 new.status='pending';new.reviewed_at=NULL;new.reviewed_by=NULL;
 new.created_at=now();
 RETURN new;
END $$;
DROP TRIGGER IF EXISTS enforce_verification_application ON public.verification_applications;
CREATE TRIGGER enforce_verification_application BEFORE INSERT ON public.verification_applications
FOR EACH ROW EXECUTE FUNCTION public.guard_verification_application();
