CREATE OR REPLACE FUNCTION public.normalize_announcement_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'pg_catalog', 'public'
AS $$
DECLARE
  requested_status text := lower(coalesce(NEW.status, 'published'));
BEGIN
  IF requested_status IN ('draft', 'archived') THEN
    NEW.status := requested_status;
  ELSIF NEW.publish_at IS NOT NULL AND NEW.publish_at > now() THEN
    NEW.status := 'scheduled';
  ELSE
    NEW.status := 'published';
  END IF;
  RETURN NEW;
END;
$$;
