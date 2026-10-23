# Timzee Tech Hub — Live performance investigation (22 Oct 2026)

## Why the site can take 5–10 seconds despite few posts

This is NOT evidence that PostgreSQL needs 5–10 seconds to read 8 published
articles. The live project's PostgreSQL statistics and query plans show
sub-millisecond to low-millisecond database execution for these small lists.
Real page load includes frontend JavaScript, network RTT, authentication,
Supabase HTTP requests, images, theme/sidebars, realtime, and the currently
deployed Netlify artifact. This audit measures SQL and source structure,
**not** end-to-end phone load time or p95 latency.

### Live baseline and verification
- Public schema: 312 indexes across 100 indexed tables **before** this batch.
- PostgreSQL approximate statistics: ~7 live posts, ~20 profiles (estimate);
  exact latest count at verification: 11 posts, 8 published. The stats are not
  exact and can lag behind writes.
- Existing indexes already covered post full-text search, communities, direct
  messages, likes and notifications. No blanket index rebuild is warranted.
- Baseline published post listing (read-only EXPLAIN ANALYZE): ~2.6 ms execution
  on one inspected query, incremental sort on previous posts index.
- Baseline videos listing: ~0.77 ms, seq scan selected on 17 rows. A sequential
  scan is often optimal on a tiny table; its appearance alone is not a bug.
- `pg_stat_statements`: public `posts.*` query used by existing clients had
  ~11.65 ms mean execution over 1,276 observed calls; one observed maximum
  was ~1.57 seconds. These aggregate values are not browser latency samples.
- Supabase performance advisor at inspection: 23 unindexed FK findings,
  43 RLS auth-initplan warnings, 2 duplicate-index warnings, 127 multiple
  permissive-policy findings, and 126 unused-index findings. Some warnings
  overlap and many unused-index measurements reflect very small tables.

### Changes applied to the live database
`20261022141500_feed_previews_keyset_indexes.sql`

- `posts.feed_excerpt` stores the first 240 characters of plain-text article
  copy so a feed never needs the full HTML body.
- A private BEFORE INSERT / UPDATE OF content trigger updates excerpts safely.
  Anonymous and authenticated roles cannot invoke the internal trigger helper.
- Backfilled all 11 existing post rows; 0 missing excerpts in the verification.
- Six targeted PostgreSQL indexes: published posts ordered by timestamp/ID,
  published posts by category/timestamp/ID, approved comments ordered by post,
  recent video comments, public videos and available marketplace listings.
  Existing indexed chat/message paths were kept unchanged; no duplicate
  indexes were intentionally added.
- EXPLAIN (ANALYZE) for the new published article preview query used
  `posts_public_cursor_idx` and finished in ~0.86 ms in the inspected run.
- SQL JSON estimate on 8 published posts:
  68,244 bytes serializing full post rows vs 6,620 bytes serializing the
  projected preview fields; about 90.3% smaller **uncompressed JSON**.
  This is not a 90% faster-page claim. Compression, HTTP overhead and media
  will change actual browser transfer sizes.

### Code changes staged in GitHub, not yet deployed
- `fetchFeedPosts` selects only whitelisted preview columns, uses
  `(created_at,id)` keyset pagination, validates cursor inputs, and caps
  page sizes at 50.
- `fetchPostCommentPage` uses approved-comment keyset paging with cap 60.
- Homepage's initial article render no longer waits for auth, theme and
  secondary sidebar. Engagement counts hydrate afterward without blocking
  articles. Popular discussions use 5 server-ranked rows rather than
  downloading all messages.
- Article detail fetches the full body once, displays it before optional
  data, gets likes via a bounded aggregate RPC, fetches 24 related previews
  and 40 initial comments, and offers Load More. Ads and media metadata are
  bounded.
- Search returns at most 40 preview rows, not all full article bodies.
- Contributor profiles and badge data are unchanged by the migration;
  RLS rules remain authoritative.

### Release and scale gates
1. Build + Node tests: `npm ci --ignore-scripts && npm run build && npm test`.
2. Run Playwright on Android-sized screens (320, 390, 768), watch page network
   waterfall/JS errors, test guest and authenticated home/article/search.
3. Verify 24th/25th item cursor boundary (same created_at, different UUIDs),
   older article comments, author badges, likes, and media gallery on two accounts.
4. Compare production Navigation Timing, resource sizes, Supabase API latency
   and 75th/95th percentile LCP for 3G/4G and Wi-Fi before/after deploying.
5. The Netlify connector reported a ready deploy dated **12 October 2026**
   for preview branch `fix/sitewide-shell-20261010` at commit
   `403d628e58711ce356a32292124d077336f9d218`. That is **not**
   evidence that this branch or the newly merged PR is deployed. Verify the
   actual production commit with `/release.json` and Netlify publishing
   before comparing screenshots/times.
6. Supabase: tune remaining 43 RLS initialization warnings with explicit
   policy-by-policy permission tests; investigate duplicate indexes only
   after confirming definitions and usage. Do not drop 126 "unused" indexes
   solely on tiny-table statistics.
7. At million-scale: use online/CONCURRENTLY index builds in planned maintenance,
   test keyset paging with large synthetic *staging* datasets, limit expensive
   per-request ranking and correlated aggregate functions, implement per-topic
   counters and asynchronous background ranking, and monitor p95/p99 latency.
8. Do not run synthetic 10-million-row inserts against the live free-tier DB.

### Backward compatibility and rollback
The migration is additive; the existing deployed clients keep working.
Reverting the GitHub performance branch restores the old client requests.
Keep the additive `feed_excerpt` column and indexes until tested removal;
do not drop them from production simply to roll back JavaScript.
No existing user content, media or accounts were removed or reclassified.

### 23 Oct direct-main resilience pass
After checking the live schema and ranked-discussion RPC, the feed/frontend code
was ported from PR #9 into the existing main branch without creating or merging
a new branch. Public article rendering now tolerates independent failures of
optional metadata, comments, ads, theme, media, account, bookmark and follow
queries. Homepage login/settings failures likewise do not hide public posts.
The additive SQL migration had already been applied to the live database via
Supabase migration tooling under generated migration version identifiers;
validate migration history before running repository migrations elsewhere.
Source-level syntax and isolated cursor/authorization tests passed; **full
npm ci/build/test, authenticated browser testing, and Netlify deployment have
not run while hosting is paused**. This remains a staged release, not a
production benchmark or a claim of launch readiness.
