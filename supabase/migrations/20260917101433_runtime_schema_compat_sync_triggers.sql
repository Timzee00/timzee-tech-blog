-- Keep legacy and current column names synchronized where the application has
-- intentionally moved between schema versions. These BEFORE triggers are
-- row-local and preserve existing data while preventing compatibility failures.

CREATE OR REPLACE FUNCTION public.sync_notifications_compat_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.link_url IS NULL AND NEW.link IS NOT NULL THEN NEW.link_url := NEW.link; END IF;
  IF NEW.link IS NULL AND NEW.link_url IS NOT NULL THEN NEW.link := NEW.link_url; END IF;
  IF NEW.notification_type IS NULL AND NEW.type IS NOT NULL THEN NEW.notification_type := NEW.type; END IF;
  IF NEW.type IS NULL AND NEW.notification_type IS NOT NULL THEN NEW.type := NEW.notification_type; END IF;
  IF NEW.data IS NULL THEN NEW.data := '{}'::jsonb; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS notifications_compat_columns_trg ON public.notifications;
CREATE TRIGGER notifications_compat_columns_trg
BEFORE INSERT OR UPDATE ON public.notifications
FOR EACH ROW EXECUTE FUNCTION public.sync_notifications_compat_columns();

CREATE OR REPLACE FUNCTION public.sync_ai_prompts_compat_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.prompt IS NULL AND NEW.system_prompt IS NOT NULL THEN NEW.prompt := NEW.system_prompt; END IF;
  IF NEW.system_prompt IS NULL AND NEW.prompt IS NOT NULL THEN NEW.system_prompt := NEW.prompt; END IF;
  IF NEW.updated_at IS NULL THEN NEW.updated_at := COALESCE(NEW.created_at, now()); END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ai_prompts_compat_columns_trg ON public.ai_prompts;
CREATE TRIGGER ai_prompts_compat_columns_trg
BEFORE INSERT OR UPDATE ON public.ai_prompts
FOR EACH ROW EXECUTE FUNCTION public.sync_ai_prompts_compat_columns();

CREATE OR REPLACE FUNCTION public.sync_curator_sources_compat_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.url IS NULL OR btrim(NEW.url) = '' THEN NEW.url := NEW.feed_url; END IF;
  IF NEW.feed_url IS NULL OR btrim(NEW.feed_url) = '' THEN NEW.feed_url := NEW.url; END IF;
  IF NEW.enabled IS NULL THEN NEW.enabled := COALESCE(NEW.is_active, true); END IF;
  IF NEW.is_active IS NULL THEN NEW.is_active := COALESCE(NEW.enabled, true); END IF;
  IF NEW.tags IS NULL THEN NEW.tags := '{}'::text[]; END IF;
  IF NEW.max_items IS NULL THEN NEW.max_items := 30; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS curator_sources_compat_columns_trg ON public.curator_sources;
CREATE TRIGGER curator_sources_compat_columns_trg
BEFORE INSERT OR UPDATE ON public.curator_sources
FOR EACH ROW EXECUTE FUNCTION public.sync_curator_sources_compat_columns();

CREATE OR REPLACE FUNCTION public.sync_curator_posts_compat_columns()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source_url IS NULL OR btrim(NEW.source_url) = '' THEN NEW.source_url := NEW.url; END IF;
  IF NEW.url IS NULL OR btrim(NEW.url) = '' THEN NEW.url := NEW.source_url; END IF;
  IF NEW.excerpt IS NULL THEN NEW.excerpt := NEW.description; END IF;
  IF NEW.description IS NULL THEN NEW.description := NEW.excerpt; END IF;
  IF NEW.source_name IS NULL THEN NEW.source_name := NEW.author; END IF;
  IF NEW.author IS NULL THEN NEW.author := NEW.source_name; END IF;
  IF NEW.image_source_url IS NULL THEN NEW.image_source_url := NEW.url; END IF;
  IF NEW.image_credit IS NULL THEN NEW.image_credit := NEW.source_name; END IF;
  IF NEW.status IS NULL THEN NEW.status := CASE WHEN COALESCE(NEW.is_posted, false) THEN 'posted' ELSE 'draft' END; END IF;
  NEW.is_posted := CASE WHEN COALESCE(NEW.status, 'draft') = 'posted' THEN true ELSE COALESCE(NEW.is_posted, false) END;
  IF NEW.updated_at IS NULL THEN NEW.updated_at := COALESCE(NEW.created_at, now()); END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS curator_posts_compat_columns_trg ON public.curator_posts;
CREATE TRIGGER curator_posts_compat_columns_trg
BEFORE INSERT OR UPDATE ON public.curator_posts
FOR EACH ROW EXECUTE FUNCTION public.sync_curator_posts_compat_columns();
