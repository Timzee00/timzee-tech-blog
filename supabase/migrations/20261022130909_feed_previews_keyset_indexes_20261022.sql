-- Lightweight public article previews and bounded feed-page access.
-- Existing articles are small; one-time backfill and regular index creation
-- are safe at the inspected row counts. For future million-row migrations
-- build new indexes CONCURRENTLY outside a transactional migration.
ALTER TABLE public.posts
 ADD COLUMN IF NOT EXISTS feed_excerpt text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION private.set_post_feed_excerpt()
RETURNS trigger LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $function$
BEGIN
 NEW.feed_excerpt := left(
   btrim(regexp_replace(
     regexp_replace(coalesce(NEW.content,''), '<[^>]+>', ' ', 'g'),
     '[[:space:]]+', ' ', 'g'
   )), 240
 );
 RETURN NEW;
END
$function$;
REVOKE ALL ON FUNCTION private.set_post_feed_excerpt()
 FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS posts_feed_excerpt_write ON public.posts;
CREATE TRIGGER posts_feed_excerpt_write
BEFORE INSERT OR UPDATE OF content ON public.posts
FOR EACH ROW EXECUTE FUNCTION private.set_post_feed_excerpt();

-- Restore previews for existing published articles; leave body, identity,
-- status and timestamp fields untouched.
UPDATE public.posts
SET feed_excerpt=left(
  btrim(regexp_replace(
    regexp_replace(coalesce(content,''), '<[^>]+>', ' ', 'g'),
    '[[:space:]]+', ' ', 'g'
  )), 240
)
WHERE feed_excerpt IS DISTINCT FROM left(
  btrim(regexp_replace(
    regexp_replace(coalesce(content,''), '<[^>]+>', ' ', 'g'),
    '[[:space:]]+', ' ', 'g'
  )), 240
);

-- Each index corresponds to an actual feed/listing query.
-- Avoid duplicating existing full-text GIN and direct-message indexes.
CREATE INDEX IF NOT EXISTS posts_public_cursor_idx
 ON public.posts(created_at DESC, id DESC)
 WHERE status='published';
CREATE INDEX IF NOT EXISTS posts_public_category_cursor_idx
 ON public.posts(category_id, created_at DESC, id DESC)
 WHERE status='published';
CREATE INDEX IF NOT EXISTS comments_approved_post_time_idx
 ON public.comments(post_id, created_at ASC, id ASC)
 WHERE status='approved';
CREATE INDEX IF NOT EXISTS video_comments_video_time_idx
 ON public.video_comments(video_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS videos_public_recent_idx
 ON public.videos(created_at DESC, id DESC) WHERE is_public=true;
CREATE INDEX IF NOT EXISTS marketplace_available_recent_idx
 ON public.marketplace_items(created_at DESC, id DESC)
 WHERE is_available=true;

COMMENT ON COLUMN public.posts.feed_excerpt IS
 'Server-maintained, max 240-character plain-text feed preview. Article body stays in post detail queries.';
