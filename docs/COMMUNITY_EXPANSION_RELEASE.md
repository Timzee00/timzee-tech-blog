# Timzee Tech Hub — Communities, My Tech and verification release candidate

**Date:** 2026-10-17
**Repository:** `Timzee00/timzee-tech-blog`
**Development:** existing PR #7, branch `fix/mobile-chat-admin-requests-analytics-20261016`
**Production:** paused by exhausted Netlify credits; no new main merge, no authenticated browser release tests.

## Implemented in this PR

### Communities
- Nairaland-style permanent subject boards with individual Reddit-style topic threads and replies; all 7 original topics and 21 legacy replies retained.
- 14 evergreen boards (AI, programming, gadgets, cybersecurity, tech jobs, gaming, startups, learning, showcase, sports, entertainment, world affairs, general, tech news).
- Public, restricted (directory-listed but member-only reading), and private (unlisted) boards; request-and-approve invitations, join/leave, roles.
- Ranked feed, chronological/active/top/unanswered views, full-text search, keyset pagination and explicit interests. `Not interested` feedback is stored privately.
- Polls (2–6 options), one vote per signed-in member, optional server-enforced close time, vote changes until close and results visibility rules.
- Up to six photographs or one short video, safe Markdown preview, emoji/text flair subject to impersonation restrictions, @mentions, reply links, bookmarks.
- Member-only media goes in the nonpublic `forum-private-media` bucket and loads through JWT-authenticated, membership-checked 180-second signed links. Public media is stored separately. Banned users lose restricted-board access.
- Per-topic and per-reply up/downvotes. Individual reply vote identities are private; score totals are returned through authorized aggregate RPCs.
- Automated *rules-based* spam quarantine for link floods, repeat posts and community-prohibited phrases; **not AI-generated toxicity verdicts**. Moderators approve or remove; pending material isn't publicly readable.
- Reports, moderator review queues, ban/unban and membership approvals. Permissions enforced in Postgres, not only the interface.
- Rate limits, database indexes, basic anti-impersonation and scope-limited temporary upload cleanup.

### My Tech
- `my-tech.html` public briefing from up to five actually published articles (not fabricated AI news), with extracts, original article dates and interest matching.
- Signed-in saved-article library using the existing `bookmarks` table.
- `My Tech · For You` community recommendations based on opted-in topics, community joins, recency, participation and diversity controls. No covert scroll-duration tracking in the algorithm.

### Verification
- Corrected the incorrect application field-name mapping in `verify.html`.
- Supporting PDF/JPEG/PNG evidence uploads use a private storage bucket; documents are referenced by restricted object paths rather than base64 in DB rows.
- Database forces status to `pending` on new applications. Application cannot self-approve or insert a verified badge.
- Business verification form now asks for organization name, official HTTPS site and representative authority details.
- **IMPORTANT:** Complete staff review/approval pages, DNS ownership proof automation, organization team workspaces and company-posting surfaces are NOT included in this release. Do not say enterprise accounts are ready.

## Algorithm explanation

Candidate posts are bounded (up to 600 recent visible threads) for predictable query cost. Results use transparent weights: opted-in topic interests, communities joined, the log of replies and nonnegative vote score, and exponential recency/activity decay. Duplicate exposure to the same community receives a diversity penalty. Users can remove individual recommendations. This is an original recommendation design, **not TikTok or Meta proprietary source code**, and ranking quality needs evaluation on real traffic.

## Automation limits and content safety

Rule-based moderation quarantines obvious spam but can flag benign posts. Moderators must be able to review and undo decisions; automated deletion/blanket banning is intentionally avoided. External AI moderation is not enabled: such integration would need provider terms, consent/privacy checks, costs and an appeals process.

The My Tech page is an *on-demand reading brief*, not an automatic editorial research/newsletter scheduler. A scheduled Brevo delivery requires enabling worker credentials, consent/frequency preferences and restoring a functioning hosting environment.

## Verification and tests

- Applied database migrations through Supabase migration tooling.
- `npm run check` now includes `tests/community-expansion.test.cjs` plus the existing production-media and forum checks.
- Basic module-syntax checks and selected static regression checks passed in an isolated inspection.
- Public React/Netlify browser build, authenticated two-account end-to-end tests, Android image editing and any commercial video/music processing were **not** run because the project is paused.
- **Never merge PR #7 into main solely from source-code checks.** Run exact-head build and smoke tests after restoring hosting.

## Mandatory release checks

1. Restore Netlify credits or migrate both static pages **and** Netlify Functions to a supported host. The new forum media signing function requires server-side functions and a configured Supabase service key.
2. Test 2 accounts plus 1 community moderator: public and private boards, join request/approval, bans and revocations, link sharing, media uploads and signed playback, feed visibility and old-topic redirects.
3. Create poll, cast vote, alter vote, let it expire; confirm guests cannot vote, one user cannot double vote, banned members cannot vote.
4. Create flagged forum post with 3 external links, confirm hidden from outsider, approve from moderator queue, test @mention notification appears only when published.
5. Upload 6 photos and a short video, reject unsupported files, test slow mobile network and failed-upload cleanup.
6. Test My Tech 5-story brief, save/unsave and interest matching with accounts from different categories.
7. Test verification application private evidence, confirm no anonymous access, verify no frontend can award itself a badge; build an audited admin-review workflow before accepting business verification applications publicly.
8. Check Supabase request quotas, database query plans and storage media costs; confirm consent and abuse-report flows; run accessibility/keyboard tests.
9. Merge only after QA and rollback plan sign-off. Do not disable row-level security to make old pages work.

## Deferred product work

Official organization workspaces with staff/publisher roles, verified company accounts and authorized publication across video/article/status/news/jobs; creator learning paths/challenges; Tech Radar tracked releases; automated high-quality five-story editorial briefing + opt-in delivery; commercially licensed music and server-side video mixing; resumable video transcoding and streaming; advanced user-controlled notification frequency; rich media editing and moderation appeals.

A secure foundation is not equal to a fully operated TikTok/Reddit-scale platform. Throughput, discovery metrics, creator incentives, anti-abuse operations and active moderation require ongoing development and measured iteration.
