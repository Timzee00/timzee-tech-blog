-- REVIEW ONLY — 15 Oct 2026. Run against isolated representative staging data.
-- These indexes support bounded public article reader queries introduced by
-- the production-hardening PR. DO NOT APPLY blindly to live Supabase.
-- Important: CONCURRENTLY must run outside a transaction, one by one.
-- Benchmark EXPLAIN (ANALYZE, BUFFERS) before/after with anon and member roles,
-- monitor build I/O, lock waits, index bloat and insert/update latency.

-- Related published articles by category ordered by recency, <=4 results.
-- The id DESC suffix makes order deterministic for equal timestamps.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_published_category_recent
  ON public.posts (category_id, created_at DESC, id DESC)
  WHERE status = 'published';

-- Published author total: exact count under RLS; can use an index-only scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_published_author
  ON public.posts (author_id)
  WHERE status = 'published';

-- Recent approved comments + paginated older comments, per article.
-- Existing comments_post_id_idx alone does not cover the sort efficiently.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_comments_approved_post_recent
  ON public.comments (post_id, created_at DESC, id DESC)
  WHERE status = 'approved';

-- Existing post_likes_post_id_user_id_key supports exact like totals and
-- a member's own liked flag. Do not create an additional redundant index.

-- Measure at least:
-- SELECT id,title,category_id,created_at,views FROM public.posts
--  WHERE status='published' AND category_id = :category
--  AND id <> :post ORDER BY created_at DESC, id DESC LIMIT 4;
-- SELECT count(*) FROM public.posts
--  WHERE author_id = :author AND status='published';
-- SELECT * FROM public.comments WHERE post_id=:post AND status='approved'
--  ORDER BY created_at DESC,id DESC LIMIT 40 OFFSET 0;
--
-- If staging plans show no gain, remove the proposed indexes. At 100k users,
-- offset pagination eventually requires cursor pagination, plus cached counts
-- and recommendation candidate generation; indexes alone do not prove scale.
