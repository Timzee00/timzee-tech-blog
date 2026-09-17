-- Defensive validation for public forms. Database rules are authoritative even when callers bypass the UI.
CREATE OR REPLACE FUNCTION public.validate_public_submission()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  clean_email text;
  recent_duplicate boolean := false;
BEGIN
  clean_email := lower(trim(coalesce(CASE WHEN TG_TABLE_NAME = 'content_requests' THEN NEW.user_email ELSE NEW.email END, '')));
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

DROP TRIGGER IF EXISTS validate_contact_request_before_insert ON public.contact_requests;
CREATE TRIGGER validate_contact_request_before_insert BEFORE INSERT ON public.contact_requests FOR EACH ROW EXECUTE FUNCTION public.validate_public_submission();
DROP TRIGGER IF EXISTS validate_support_request_before_insert ON public.support_requests;
CREATE TRIGGER validate_support_request_before_insert BEFORE INSERT ON public.support_requests FOR EACH ROW EXECUTE FUNCTION public.validate_public_submission();
DROP TRIGGER IF EXISTS validate_content_request_before_insert ON public.content_requests;
CREATE TRIGGER validate_content_request_before_insert BEFORE INSERT ON public.content_requests FOR EACH ROW EXECUTE FUNCTION public.validate_public_submission();
DROP TRIGGER IF EXISTS validate_ad_application_before_insert ON public.ad_applications;
CREATE TRIGGER validate_ad_application_before_insert BEFORE INSERT ON public.ad_applications FOR EACH ROW EXECUTE FUNCTION public.validate_public_submission();
DROP TRIGGER IF EXISTS validate_newsletter_signup_before_insert ON public.newsletter_signups;
CREATE TRIGGER validate_newsletter_signup_before_insert BEFORE INSERT ON public.newsletter_signups FOR EACH ROW EXECUTE FUNCTION public.validate_public_submission();

CREATE UNIQUE INDEX IF NOT EXISTS newsletter_signups_email_unique_idx
  ON public.newsletter_signups (lower(trim(email)))
  WHERE email IS NOT NULL AND trim(email) <> '';
