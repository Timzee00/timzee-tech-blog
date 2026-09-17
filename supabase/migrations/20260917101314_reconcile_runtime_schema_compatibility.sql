-- Reconcile live production schema with the fields used by current runtime code.
-- Additive and idempotent: existing data is preserved.

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS link_url text,
  ADD COLUMN IF NOT EXISTS data jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS notification_type text;

UPDATE public.notifications
SET link_url = COALESCE(link_url, link),
    notification_type = COALESCE(notification_type, type)
WHERE link_url IS NULL OR notification_type IS NULL;

ALTER TABLE public.ai_prompts
  ADD COLUMN IF NOT EXISTS system_prompt text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS category text,
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.ai_prompts
SET system_prompt = COALESCE(system_prompt, prompt),
    updated_at = COALESCE(updated_at, created_at)
WHERE system_prompt IS NULL OR updated_at IS NULL;

ALTER TABLE public.ai_conversations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

UPDATE public.ai_conversations
SET updated_at = COALESCE(updated_at, created_at)
WHERE updated_at IS NULL;

ALTER TABLE public.content_reports
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.posts
  ADD COLUMN IF NOT EXISTS content_type text;

ALTER TABLE public.curator_settings
  ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS posts_per_source integer NOT NULL DEFAULT 5;

UPDATE public.curator_settings
SET enabled = COALESCE(enabled, scout_enabled, true),
    posts_per_source = COALESCE(posts_per_source, 5);

ALTER TABLE public.curator_sources
  ADD COLUMN IF NOT EXISTS query text,
  ADD COLUMN IF NOT EXISTS tags text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS image_credit text,
  ADD COLUMN IF NOT EXISTS max_items integer NOT NULL DEFAULT 30;

UPDATE public.curator_sources
SET feed_url = COALESCE(feed_url, url),
    enabled = COALESCE(enabled, is_active, true),
    tags = CASE WHEN cardinality(tags) = 0 THEN COALESCE(filter_keywords, '{}') ELSE tags END,
    image_credit = COALESCE(image_credit, name),
    max_items = COALESCE(max_items, 30)
WHERE feed_url IS NULL
   OR tags = '{}'
   OR image_credit IS NULL
   OR max_items IS NULL;

ALTER TABLE public.curator_posts
  ADD COLUMN IF NOT EXISTS source_name text,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS excerpt text,
  ADD COLUMN IF NOT EXISTS source_url text,
  ADD COLUMN IF NOT EXISTS image_source_url text,
  ADD COLUMN IF NOT EXISTS image_credit text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

UPDATE public.curator_posts
SET source_url = COALESCE(source_url, url),
    source_name = COALESCE(source_name, author),
    excerpt = COALESCE(excerpt, description),
    image_source_url = COALESCE(image_source_url, url),
    image_credit = COALESCE(image_credit, author),
    status = CASE WHEN is_posted THEN 'posted' ELSE COALESCE(status, 'draft') END,
    updated_at = COALESCE(updated_at, created_at)
WHERE source_url IS NULL
   OR source_name IS NULL
   OR excerpt IS NULL
   OR image_source_url IS NULL
   OR image_credit IS NULL
   OR updated_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS curator_posts_source_url_compat_uidx
  ON public.curator_posts(source_url)
  WHERE source_url IS NOT NULL;
