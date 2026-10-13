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
- Other scale risks remain: homepage fetches unbounded post likes, comments and discussion records; unbounded friendships and group memberships; N+1 reel likes counts; realtime channel/billing ceilings; file size and egress, moderation operations, abuse and rate limits, and archival.

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
