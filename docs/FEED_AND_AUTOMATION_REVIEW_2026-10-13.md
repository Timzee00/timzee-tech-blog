# Feed algorithms and automation: engineering review — 13 October 2026

**Status:** Real code fixes in draft PR #4, tested only by isolated logic/source checks. Neither SQL proposal nor new PR branch is deployed. This is not a 100k-user throughput certification.

## Current real algorithm

- `get_personalized_feed(p_limit, p_content_type)` is currently a Supabase SQL function. It ranks five content types using a freshness score, post likes/comments/shares, followed creators and communities, bookmarked/liked-topic signals, novel subscriptions, view popularity, and per-user hide/not-interested feedback.
- `get_following_feed` uses followed creators and communities, but unlike personalized SQL it does not currently exclude all negative user feedback. PR #4 therefore offers Not interested only on For You, pending a server-side parity review.
- `get_trending_posts` weights reactions in the past 72 hours and decays older content; `get_popular_posts` weighs total likes/comments/shares/views. All are live ranked queries; none are a trained recommender or guaranteed to operate efficiently at scale.
- Existing personalized SQL runs correlated aggregate counts over public content and sorts candidates on each request. Heavy traffic requires a bounded, shared candidate layer with per-viewer reranking, rather than 100k independent full-table computations.

## For You improvements committed

- Added an actual For You / Following mode selector, category filters with `aria-pressed`, and clear user-facing copy describing *implemented* signals instead of implying that watch-time or dwell-time learning already exists.
- A deterministic diversity reranker deduplicates content and limits repeated authors/content types within the first viewport when alternatives exist. It never discards legitimate content just to satisfy a quota.
- In-memory 45-second caching avoids redundant RPC calls from quick mode/filter switching on the same page; a manual Refresh ignores the cache.
- `Not interested` persists via an RLS-protected user_content_feedback upsert; the card is hidden only after success, the cache is invalidated, and Undo deletes the user's own feedback. Retry handles network failures.
- Browser tests were added for the mode switch and feedback/Undo, alongside isolated unit tests. Full browser tests remain unexecuted.

## Scheduled automation actually running

- `automation-maintenance` is configured in Netlify every 5 minutes. On October 13 2026, public.system_job_status reported 22,109 runs, latest successful, no recorded failure.
- `scout-news` is configured hourly. It fetches RSS/GDELT content **as drafts for human editorial review** and does not safely or automatically publish unverified content.
- News-scout changes bound work to four sources/run, six draft articles/source, 30 scanned feed items/source, six-second external timeouts and an 18-second work budget. It rotates least-recently-visited sources, tolerates duplicate source URLs using the unique database constraints, and records scout status. These changes are committed but not deployed.
- Netlify scheduled functions cannot be called through a normal URL. The new manual HTTP gateway `scout-news-manual` keeps server-side Super Admin verification and strips schedule headers; dashboard and curator UI now call the manual endpoint.

## Server-side automation design, NOT switched on

- `netlify/functions/_lib/feed-refresh.cjs` provides a **disabled-by-default** scheduled hook on the existing five-minute maintenance timer. It calls a bounded RPC only when FEED_CANDIDATE_REFRESH_ENABLED=true.
- `docs/sql/review-only-feed-candidate-cache.sql` sketches a private, service-only shared candidate snapshot, fifteen-minute cooldown and advisory-lock de-duplication. It has **not** been migrated or connected to the personalized-feed reader. A vetted RLS-aware reader and validated candidate quality are mandatory first.
- The present announcement maintenance function broadcasts each global announcement as one `notifications` row per profile. At 100k accounts, that creates a 100k-write/realtime burst. `docs/sql/review-only-announcement-inbox.sql` proposes a single published announcement plus per-viewer read receipts under RLS. **Do not run this SQL without migrating the bell and maintenance worker together**.
- Supabase recommends Realtime Broadcast rather than Postgres Changes for high-scale subscriptions, so chat/notification streams need a staged move to private Broadcast channels with authorization tests. This migration is not done.

## Priorities for production-ready 100k registered accounts

1. Isolated staging with fake users/content, real service quotas, and exact deployed release SHA. Existing Netlify previews have used production Supabase; do not run write/load tests there.
2. Run clean `npm ci`, `npm run build`, `npm test`, Playwright and E2E journeys for sign-in, FYP, feedback, moderation, chat, media, search, staff workflows, and Scout Now.
3. Profile feed SQL (`EXPLAIN ANALYZE` against large synthetic volumes) and build cached candidates with freshness, diversity, abuse resistance and RLS-safe per-user filtering. Compute shared ranking periodically, personalize cheaply on reads.
4. Separate the high-volume media moderation, notifications, image/video processing and recommendation counters into bounded, idempotent durable queues with retries, dead-letter observability and operational limits.
5. Track relevance metrics (like/save/follow rate, Not interested rate, returning-reader satisfaction, creator distribution, spam exposure), plus latency p95/p99, error rate, database CPU/IO, realtime sockets, queue depth and egress costs. Avoid encouraging addictive engagement at the expense of safety and user control.
6. Implement a global announcement inbox and private realtime broadcasts rather than an insert storm for each global message; stage rollout and data compatibility first.

**Buyer-review disclosure:** The personalization is a rule-based SQL ranker plus a frontend diversity layer—not a trained TikTok-style ML recommender. The opt-in precompute hook and proposed SQL remain disabled/unapplied. Neither recommendation quality nor 100k-user throughput is independently validated.


## October 13: traced Scout and video-discovery blockers

- **Observed live DB (read-only):** one enabled curator settings row, eight enabled RSS sources, zero curated posts, and most recent legacy scout status = failed on 2026-10-12 21:57:30 (database timestamp). The eight source rows have no successful fetch timestamp. These findings prove imports were unsuccessful, but are not a Netlify stack trace.
- **Deployment mismatch:** Netlify deployment `6acd53ca0128bd66b2f9f70c` (PR #4 preview, built 2026-10-12, commit `403d628e58711ce356a32292124d077336f9d218`) has the old scheduled `scout-news`, but its available functions do NOT include the later `scout-news-manual` or `scout-news-status` endpoints. The new web UI cannot work on that older deployment yet. Netlify scheduled functions do not run automatically on Deploy Previews and cannot be directly called via URL; only a *published* deployment runs the hourly schedule. Netlify's Functions **Run now** UI can invoke a scheduled function for debugging without publishing.
- **Confirmed source insert schema mismatch:** `curator_sources.url` is NOT NULL; the curator UI's Add Source wrote `feed_url` but omitted `url`. Creating a source would fail. Source edits also updated only `feed_url`. Both now write both fields consistently, with runtime fixture tests.
- **New secured diagnosis:** `netlify/functions/scout-news-status.js` uses service-role Supabase server access only after validating a signed-in account has the current trusted Super Admin role. It reports source counts, imported drafts, last run/status and enable flags without sending feed URLs, provider keys or access tokens. The curator page now displays this status and each source's last error and failures; ordinary Admins cannot invoke manual Scout Now.
- **Scout enabled semantics:** Scheduled/manual scanner honors both `enabled` and `scout_enabled`, not just one flag.
- **Video reliability:** `assets/js/video-discovery.mjs` now caches even empty candidate sets and uses latest visible public videos as the cold-start fallback for For You only. An empty/denied Following feed is never replaced by public Latest results. The fallback remains subject to Supabase RLS and public-only filtering.
- Five targeted mock-function logic checks passed for video cold-start/privacy and scout summary; two additional runtime fixture checks passed for source create/update URL contract. Full repository tests, Netlify function execution, API key scope, Brevo SMTP delivery and live import have NOT been verified.

### Safe operational next checks (no production writes yet)

1. Check Netlify published deploy's **Functions → scout-news** scheduled badge, recent executions and logs. Separately check the PR preview, which **will not** run an hourly schedule by itself.
2. Confirm the published deployment has `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (or the fallback `SERVICE_ROLE_KEY`) available at **Functions runtime**. Never share the key in chat. An old deployment may not have recent environment changes.
3. When an isolated staging backend and verified new preview exist, use the new Super Admin Scout Status display and Sync Now. Inspect per-source error details and verify at least one **draft** is persisted and viewable in the curation queue. Do not automatically publish third-party content.
4. If no RSS sources are fetched, inspect the precise host/network/parser error; a healthy HTTP 200 on the general site health route does not prove scout execution.
5. Confirm that Netlify previews contain the exact Git SHA under test, AI proxy sees the provider key scoped to Functions, and Supabase Auth SMTP uses a Brevo **SMTP credential**, not Netlify's AI key.
