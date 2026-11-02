-- Restore public form submissions after a later function replacement regressed content_requests.
-- Preserve the existing validation, duplicate guard, and trigger bindings for all five forms.
CREATE OR REPLACE FUNCTION public.validate_public_submission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  clean_email text;
  recent_duplicate boolean := false;
BEGIN
  -- content_requests stores user_email, not email; PL/pgSQL must reference the right record column.
  IF TG_TABLE_NAME = 'content_requests' THEN
    clean_email := lower(trim(coalesce(NEW.user_email, '')));
    NEW.user_email := nullif(clean_email, '');
  ELSE
    clean_email := lower(trim(coalesce(NEW.email, '')));
  END IF;
  IF TG_TABLE_NAME = 'newsletter_signups' THEN
    IF clean_email = '' OR clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'Please provide a valid email address.' USING ERRCODE = '22023';
    END IF;
    NEW.email := clean_email;
    IF length(clean_email) > 320 THEN RAISE EXCEPTION 'Email address is too long.' USING ERRCODE = '22001'; END IF;
  ELSE
    IF clean_email <> '' AND clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
      RAISE EXCEPTION 'Please provide a valid email address.' USING ERRCODE = '22023';
    END IF;
    IF length(clean_email) > 320 THEN RAISE EXCEPTION 'Email address is too long.' USING ERRCODE = '22001'; END IF;
  END IF;

  IF TG_TABLE_NAME IN ('contact_requests', 'support_requests') THEN
    IF length(coalesce(NEW.name, '')) > 120 THEN RAISE EXCEPTION 'Name is too long.' USING ERRCODE='22001'; END IF;
    IF length(coalesce(NEW.message, '')) > 5000 THEN RAISE EXCEPTION 'Message is too long.' USING ERRCODE='22001'; END IF;
  ELSIF TG_TABLE_NAME = 'content_requests' THEN
    IF length(coalesce(NEW.user_name, '')) > 120 THEN RAISE EXCEPTION 'Name is too long.' USING ERRCODE='22001'; END IF;
    IF length(coalesce(NEW.query, '')) > 2000 THEN RAISE EXCEPTION 'Request is too long.' USING ERRCODE='22001'; END IF;
  ELSIF TG_TABLE_NAME = 'ad_applications' THEN
    IF length(coalesce(NEW.name, '')) > 120 OR length(coalesce(NEW.company, '')) > 160 THEN RAISE EXCEPTION 'Application fields are too long.' USING ERRCODE='22001'; END IF;
    IF length(coalesce(NEW.message, '')) > 5000 THEN RAISE EXCEPTION 'Message is too long.' USING ERRCODE='22001'; END IF;
  ELSIF TG_TABLE_NAME = 'newsletter_signups' THEN
    IF length(coalesce(NEW.name, '')) > 120 THEN RAISE EXCEPTION 'Name is too long.' USING ERRCODE='22001'; END IF;
    IF length(coalesce(NEW.interest, '')) > 300 THEN RAISE EXCEPTION 'Interest is too long.' USING ERRCODE='22001'; END IF;
  END IF;

  IF TG_TABLE_NAME = 'contact_requests' THEN
    SELECT EXISTS (SELECT 1 FROM public.contact_requests r WHERE lower(trim(coalesce(r.email,'')))=clean_email AND coalesce(r.message,'')=coalesce(NEW.message,'') AND r.created_at > now()-interval '60 seconds') INTO recent_duplicate;
  ELSIF TG_TABLE_NAME = 'support_requests' THEN
    SELECT EXISTS (SELECT 1 FROM public.support_requests r WHERE lower(trim(coalesce(r.email,'')))=clean_email AND coalesce(r.message,'')=coalesce(NEW.message,'') AND r.created_at > now()-interval '60 seconds') INTO recent_duplicate;
  ELSIF TG_TABLE_NAME = 'content_requests' THEN
    SELECT EXISTS (SELECT 1 FROM public.content_requests r WHERE lower(trim(coalesce(r.user_email,'')))=clean_email AND coalesce(r.query,'')=coalesce(NEW.query,'') AND r.created_at > now()-interval '60 seconds') INTO recent_duplicate;
  ELSIF TG_TABLE_NAME = 'ad_applications' THEN
    SELECT EXISTS (SELECT 1 FROM public.ad_applications r WHERE lower(trim(coalesce(r.email,'')))=clean_email AND coalesce(r.message,'')=coalesce(NEW.message,'') AND r.created_at > now()-interval '60 seconds') INTO recent_duplicate;
  ELSIF TG_TABLE_NAME = 'newsletter_signups' THEN
    SELECT EXISTS (SELECT 1 FROM public.newsletter_signups r WHERE lower(trim(coalesce(r.email,'')))=clean_email) INTO recent_duplicate;
  END IF;

  IF recent_duplicate THEN
    RAISE EXCEPTION 'This submission was already received.' USING ERRCODE='23505';
  END IF;
  RETURN NEW;
END;
$$;
