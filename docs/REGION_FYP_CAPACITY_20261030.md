# Blipmood Region & Capacity Manager / Lightweight FYP

**Date:** 30 October 2026  
**Repository:** `Timzee00/timzee-tech-blog`  
**Deployment status:** new changes committed to `main`, DB migrations applied; published Netlify release and Lighthouse scores **not verified**.

## What is in place
- **Regional feature controls:** one audited, super-admin-only rule table, optional country-specific override, start/end dates, deterministic account rollout percentage, default global behavior. Unreleased monetization is off by default.
- **Geographic safeguards:** reviewed account residence has priority. For non-financial features, an approximate country is observed by a Netlify function (using platform geo, not user-supplied headers). It is cached for 72 hours and aged out by free pg_cron. Only synchronize a member when country rules actually exist. A CDN-cacheable, non-personal status check avoids per-user geolocation work under global defaults.
- **Server-enforced writes:** restrictive Supabase RLS for new videos/thumbnail storage, new marketplace listings, new Spaces rooms and Profile FX saves. Existing content is never deleted by regional controls. The core personalized FYP function also checks availability; recommendation cold-start fallback cannot bypass disabled regions. Financial/legal eligibility still requires a reviewed region, not IP alone.
- **Bounded video recommendations:** a 15-minute job stages candidate IDs from a limited recent video slice (max 2,000), creates up to 200 trending and 80 fresh candidates, and a new RLS-invoker RPC selects a max of 50 IDs scoped by viewer following and negative feedback. The video discovery client preserves older ranking RPCs only for older deployments missing the new RPC; this fallback will be removed after sustained validation.
- **Bounded mixed For You:** existing personalized feed limits candidate sources to recent 300 posts, 250 discussions, 350 videos, 180 novels and 180 marketplace listings before existing engagement signals. This bounds DB work, but heavy row-level reaction counts are not a tested 100k-user design yet.
- **Video view history:** original UTC daily deduplication continues. Scheduled pruning deletes up to 4,000 aged rows/table/day after 30 days while preserving aggregate view counts, so future high-volume traffic will require more frequent/batched partition cleanup.
- **Media budget:** new videos capped at 20 MiB by default; thumbnail limit 2 MiB. At 60% media budget, super admin receives one daily in-app warning; at 80%, new video cap reduces to 6 MiB; at 95%, new metadata is blocked until sufficient headroom. Supabase storage ownership and actual file size are rechecked server-side. Client rejects oversized inputs before uploading; newly uploaded orphaned files are removed on DB insert failure. Existing videos are not touched.
- **CDN:** newly created video URLs are immutable and uploaded with a seven-day cache header. Reel page already preloads only the current and adjacent videos when data saver is off and only current in data saver mode.
- **Operations:** super admin page `/super/region-capacity.html` shows feature rules, member region review, a private on-demand database/storage snapshot, upload thresholds. From `/super/professional-panel.html` choose **Region & Capacity**. No page periodically polls storage or stores user IP.

## Verified directly on linked services
- DB volume about 32 MB. `media` + `chat-media` Supabase objects total ~232,587,366 bytes on 30 October. Current video table 23 rows; new candidates 46 rows.
- All migration apply calls succeeded, migration files committed with matching Supabase versions.
- Anonymous session can use the existing public feed and compact candidate feed with global enabled defaults.
- Public/unauthenticated roles cannot write flags, spoof `platform_observed_regions` or read private capacity inventory.
- Transaction + rollback confirmed: global default permits, unknown country cannot bypass an override, the blocked country is denied, and the enabled country is allowed.
- Four observed cron schedules are present; one logged scheduled execution succeeded. Future periodic job execution needs monitoring.
- Six new region-capacity security/structure checks passed in a local V8 harness; four video-discovery behavior tests passed with mocks. Full Netlify Node build, Playwright E2E, production launch and Lighthouse **remain unverified**.
- Supabase Database Advisors flagged multiple pre-existing performance and security recommendations unrelated to this change, including missing FK indexes and RLS-no-policy private tables. The new client-unreadable observed-region table deliberately has RLS with no client SELECT policy. The app needs a separate security review before very large scale.

## 100,000 concurrent visitors — engineering objective, not a proven capacity
100,000 simultaneous video viewers at 1 Mbps each need about **100 Gbps** of sustained delivery (**45 TB of transfer per hour**) even if PostgreSQL handles metadata perfectly. At 0.5 Mbps average, it is about 50 Gbps. No free Supabase/Netlify plan can guarantee that traffic, and optimizing SQL cannot eliminate the delivery cost. The project currently has dozens of video records, not 100k active sessions. Do not claim these changes certify 100k no-lag.

### Gradual load testing required before a real capacity commitment
1. Deploy current commit to a disposable Netlify preview; run `npm run check`, `npm test`, `npm run build` and browser tests. Keep the existing published release available for rollback.
2. Run Lighthouse mobile/desktop on home, FYP, videos, video playback, region admin and uploads. Confirm cache control and no animation or hydration regressions.
3. Use synthetic, nonproduction load scenarios (100 → 500 → 2,000 → 10,000), including account-scoped RPCs, comments/likes, upload rejection and watch analytics. Record p50/p95/p99 response time, DB CPU/connections, error rate, cache hit ratio, egress and cost. Stop on resource exhaustion.
4. Before scaling to 100k concurrent viewing, budget for a professional video transcoding/CDN service, streaming adaptive bitrate, event aggregation/queue/partitioned history, multi-region delivery, load shedding, and provider quotas. Protect Supabase with DB connection/edge caching; do not rely on 100k direct DB realtime listeners.
5. Keep GDPR/privacy/data-retention notices and storage/egress alerts current, and verify free-tier quotas and billing ceilings through the actual providers.

## Non-claims
- The regional features **do not** promise location certainty for travellers, VPNs or unverified accounts. They enforce rules based on server-observed or reviewed evidence and fail closed where overrides exist.
- These changes **do not** create or deploy a real video transcoder, unlimited free streaming, queue infrastructure or a 100,000-user performance guarantee.
- No existing media is automatically deleted.
