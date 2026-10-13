# Scale-readiness checkpoint — 100,000 registered users

**October 13, 2026. Status: source improvements committed; capacity NOT certified.** The target is 100,000 registered accounts, not 100,000 concurrent realtime users. Performance depends on daily active users, concurrent connections, posts, media, traffic and provider limits.

## Implemented in draft PR #4

1. Direct-message list: read only the latest message per thread, never all chat history. `assets/js/chat-previews.mjs` batches at 64 via an optional SECURITY INVOKER database function. Until it is installed, fallback is exactly one indexed top-one query per thread, with at most five simultaneous queries. Regression tests check duplicate IDs, query batching, fallback and access denials.
2. Full-screen video comments: server pages of 40, `Load more comments`, retryable failures and protection against stale replies if the user changes or closes the video drawer. The UI does not download all comments for a popular video. Offset pagination needs keyset/cursor pagination for very deep histories.
3. Video view count: removed unsafe browser read-then-write of `view_count`. Existing RLS permits only video owners to update their rows, so ordinary viewers' direct updates were blocked and concurrent updates could lose counts. A server RPC is proposed to count at most one authenticated view per user/video/UTC day via an atomic update; it is NOT yet migrated. The client does not bypass RLS if the RPC is missing. Anonymous view attribution needs a separately rate-limited server design.
4. Added a capped read-only staging probe (`scripts/staging-load-probe.mjs`) that refuses the production domain, limits request concurrency to 20 and sample count to 400, and reports errors, throughput and latency percentiles. The probe has NOT been run against a live host.

## Existing data and query findings

- The production DB is small (approximately 88 direct messages, 20 notifications, 1 post and 1 marketplace item by Postgres statistics). This cannot substantiate 100k-user capacity.
- The DB already has `(thread_id, created_at DESC)` on direct messages and indexes for notification owner/read status and marketplace full-text search.
- Post listing queries have no ordinary `posts.created_at DESC` index; video comments have a `video_id` index but lack the compound `(video_id, created_at DESC, id DESC)` index. Benchmark with representative data before adding indexes because they cost extra space and writes.
- The homepage now shows 24 articles per page, filters future scheduled posts before pagination, renders posts without waiting for counts, and loads exact per-post like/comment summaries instead of downloading all reaction rows. The reviewed RLS-invoker RPC proposal is in docs/sql/review-only-post-engagement.sql, with bounded exact-count fallback for older databases. The SQL function is NOT deployed. Deep post pagination still uses OFFSET and should eventually become a created_at/id keyset cursor.
- Other scale risks remain: unbounded discussion-message reads and friendship/group memberships; N+1 reel like counts; realtime/billing ceilings; file size and egress; moderation queues; spam/rate limits; and archival.

## Review-only backend SQL

- `docs/sql/review-only-chat-preview-rpc.sql` proposes the RLS-preserving preview batching function; do not use SECURITY DEFINER there.
- `docs/sql/review-only-atomic-video-view.sql` proposes guarded SECURITY DEFINER view counting. Must confirm function ownership, authenticated execution only, no direct rights to event table, RLS, anti-fraud rules and same-day concurrent requests in staging.
- Neither proposal was applied to the live Supabase project. Convert reviewed SQL into proper migrations using the project's Supabase CLI workflow in an isolated environment.

## Safe acceptance sequence

1. Create a separate Supabase staging project with synthetic, non-sensitive users, role assignments, friendship graphs and large generated discussions and video comments. Current Netlify preview uses production Supabase and is NOT isolated.
2. On the exact branch SHA run `npm ci`, `npm run build`, `npm test`, and `npm run test:browser` locally/CI. Fix failures, test light/dark and mobile, multi-user auth, role boundaries and signed media.
3. Deploy a preview that connects ONLY to staging. After credit/billing approval, use `node scripts/staging-load-probe.mjs https://deploy-preview-N--timzee-tech-blog.netlify.app 10 100` for read-only low-volume smoke load. It is not a capacity certificate.
4. Test realistic logged-in journeys with k6/Locust and synthetic credentials: ramp 10, 50, 100, then 500 active users (only as your paid quotas allow). Monitor p50/p95/p99, error %, Supabase CPU/IO, connections, realtime subscriptions, storage egress and Netlify function invocation/cost; establish actual SLOs.
5. Optimize the worst SQL query plans and RLS overhead, enable paged/virtualized feeds, add rate limiting and background jobs, plan retention/archival, autoscaling and database backup/restore/rollback. Re-test after each change.

**Release gate:** no claim of 100k-user readiness until observed performance under representative synthetic traffic, reproducible tests, secured backend proposals, and operating-cost evidence are recorded. CI/build, preview deployment and load testing remain outstanding.

## Further review-only proposals

- docs/sql/review-only-scale-indexes.sql: posts chronological listing, video comment pages, discussion topic message order and approved-comment lookup indexes. Validate their value and write cost with staging EXPLAIN before creating any production indexes.
- Post engagement RPC is SECURITY INVOKER and grants access to anon/authenticated while retaining underlying RLS. Exact liked state uses indexed EXISTS with auth.uid(); it cannot be computed using user-supplied identity.
- Stage SQL in real migrations using the Supabase CLI only after confirming schema and security; no live SQL writes or policy changes were carried out.
- The new homepage only bounds article page size and article engagement queries. The remaining discussion-homepage full-table queries must be replaced by grouped, server-side summaries. Do not call the entire platform fully scalable yet.

## Immediate verification checkpoint

- In an isolated JavaScript exercise, the actual chat-preview module passed three checks (64-id RPC batches, five-in-flight legacy fallback, access-denial propagation).
- The actual engagement summary module passed three comparable mocked-data checks (exact totals, bounded exact-count fallback, access-denial propagation).
- The complete Node test suite, Playwright regressions, reproducible deployment build, Netlify preview and multi-user staging load tests have NOT run in this step. GitHub Actions billing was previously blocked.
