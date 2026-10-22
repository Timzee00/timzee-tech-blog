-- Query-driven, non-destructive indexes for the existing public feed API.
-- Legacy published rows can have NULL status; older scheduled rows may be due.
-- Existing partial indexes on status='published' alone cannot serve this OR.
CREATE INDEX IF NOT EXISTS posts_legacy_public_feed_cursor_idx
  ON public.posts(created_at DESC,id DESC)
  WHERE status IS NULL OR status='published' OR status='scheduled';
CREATE INDEX IF NOT EXISTS posts_legacy_public_category_cursor_idx
  ON public.posts(category_id,created_at DESC,id DESC)
  WHERE status IS NULL OR status='published' OR status='scheduled';
CREATE INDEX IF NOT EXISTS posts_slug_lookup_idx
  ON public.posts(slug) WHERE slug IS NOT NULL;
CREATE INDEX IF NOT EXISTS posts_tags_filter_gin_idx
  ON public.posts USING gin(tags);
-- Creator pages and the live story tray need ordered, bounded lookups.
CREATE INDEX IF NOT EXISTS posts_author_public_recent_idx
  ON public.posts(author_id,created_at DESC,id DESC)
  WHERE status IS NULL OR status='published';
CREATE INDEX IF NOT EXISTS stories_user_expiry_recent_idx
  ON public.stories(user_id,expires_at DESC,created_at DESC)
  WHERE expires_at IS NOT NULL;
-- Index maintenance statistics are not proof of latency: use EXPLAIN and
-- production request traces before considering more indexes.
