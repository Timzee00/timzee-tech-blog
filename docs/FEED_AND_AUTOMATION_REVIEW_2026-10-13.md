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
