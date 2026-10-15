# Timzee Tech Hub — engineering hardening and release gates
**Audit:** 15 October 2026 • **Branch:** `audit/production-hardening-20261015` • **Target:** `main`

## Evidence (read-only, 15 Oct)
- GitHub PR #3: merged into main. PR #4: **closed, not merged**. The old dev branch diverged and held three unmerged UX changes; this branch ports those selectively.
- Live Supabase curator: **66 records**, **8 marked as posted**, **20 enabled feeds**, most recent Scout result **partial** on 14 Oct. Source errors include timeout, 429 throttling and invalid XML. Scout is not uniformly failing, but not fully reliable.
- `curator-scout` system job has recorded timestamps/results but `run_count=0`, so that counter is **not trustworthy** until its atomic increment is implemented.
- Live `touch_chat_thread_updated_at` compares a UUID id to a TEXT value; message insertion can raise SQLSTATE 42883. Group members also lack general permission to update `chat_threads`. A reviewed trigger repair is provided in `docs/sql/review-only-chat-thread-activity-v2.sql`, **not applied**.
- `post_media` is empty, while 35 source drafts have image URLs and only two published posts currently have covers. New publishing intentionally embeds rights-approved images inside HTML instead of duplicating in `post_media`; empty gallery table **alone does not prove** every article has missing media. Verify rights and resulting HTML per article.
- AI editorial `consume_ai_rate_limit` RPC exists with five parameters, including `p_now`. Production API keys, deployed provider access, Brevo SMTP and Webhooks have **not been verified end-to-end**.
- No verified passing full `npm run check`, `npm test`, `npm run build`, Playwright or staged load test has been collected for this branch. No CI status was reported for the inspected main commit.

## Read-only public-browser check
A 390×844 mobile browser check at `https://timzee-tech-blog.netlify.app/` found no horizontal overflow, a working menu and a readable footer. The cookie panel occupies much of the initial viewport. The public article at `/post.html?id=b21aaa8a-e08a-47ea-93a4-81918943a5a9` loaded its body after a visible generic loading state; this branch reduces that delay and uses meaningful loading text. The device-specific grey broken-image strip was **not reproduced** in the controlled browser. The check did **not** exercise authenticated or production-write workflows.

## Changes included in this PR
- Port unmerged mobile preview containment, sensible empty-state and idempotent @mentions, and persistent reel mute state on autoplay fallback from the closed PR.
- Recognize compact GDELT timestamps when scoring fresher news.
- Bound public article reader requests: related posts, published-author counts, total likes and recent comments. Load older comments in pages rather than all at once.
- Make article rendering progressive (public content before auth/settings/ads), preserve previously seen comment author profiles, and prevent transient comment/like failures from replacing readable articles.
- Prevent rapid repeat likes and incorrect displayed count updates after database rejection.
- Stage secure UUID thread-touch migration with a membership check and index-friendly UUID comparison. **No live migration.**

## Required acceptance gates — never mark complete without recorded evidence

| Area | Staging/production acceptance evidence |
|---|---|
| Netlify deployment | Match published SHA to reviewed PR SHA; `npm ci`, check, test, build and focused Playwright all pass; preview must have isolated credentials and test data. |
| AI providers | Test authenticated Groq and OpenRouter requests against deployed Functions using selected model; distinguish missing key vs model/quota error; preview env scope/config verified without exposing secrets. |
| Curator Scout | 4 sources succeed, 429/XML/timeouts yield nonfatal partial status, draft import/dedup/attribution preserved, correct last run metrics. Verify status and actual imported rows. |
| News/roundups | Ranking diversity, publication dates, legitimate opportunities, official deadlines, language translation, 2–6 sourced roundup items, no invented claims or illegal 'free' exploits. |
| Curator editor | AI expand, translation, private preview mobile viewport, responsive embeds, media rights attestation and citations; drafts are not silently auto-published or duplicated. |
| Article reader | Correct takeaways distinct from body; licensed in-context images load, correct alt/attribution, no overflow; login/logout and anonymous access work; summarize/chat AI cites article. |
| Reels and feeds | FYP/Following, full-screen swipe and rewind, meaningful buffering, autoplay policy, mute persistence, data saver, cached return playback, safe pagination, likes/comments/counts, creator follows and mentions. |
| Chat and friends | Apply reviewed thread trigger in staging; send/reply/attachments/voice/reactions, private signed media, two-account realtime, blocked and staff-authorized interactions, read receipts and notifications. |
| Profile/settings | Profile covers/video grid, followers/friends, all settings persistence and RLS, global sign-out/password, light/dark/reduced motion, mobile menu keyboard and safe-area controls. |
| Email | Supabase Auth SMTP **separately** configured with Brevo SMTP key; transactional `BREVO_API_KEY` and verified sender tested, bounce/unsubscribe/webhook authenticity and opt-in, retry queue/rate-limits and no broad unsolicited sends. |
| Security | Live RLS audit for every public table/Storage bucket, Auth role backstop, keys never in public bundles, safety caps, XSS sanitization and URL validation, rate limits and incident logs. |
| Scalability | Isolated realistic 100k-user candidate dataset, paginated/recommendation query plans and indexes, realtime concurrency/notification fan-out bounded, queue retries and performance budgets; **not proven yet**. |
| Operations | Backup, rollback scripts, production env scope, audit trail and alerts, mobile real-device test, WCAG checks, preview noindex and sitemap SEO. |

### Rollout
1. Merge/release code only after independent checks. Do not deploy a PR preview against the production Supabase database for destructive tests.
2. Apply review-only SQL migrations **in staging first**, verify two authenticated users and authorization restrictions, then obtain production backup and approval before any live schema change.
3. Verify the actual Netlify publish SHA and configured environment **per deploy context**. Updating an environment variable without a deployment does not guarantee that an old function has the new value.
4. Conduct sampled public read-only smoke tests, then a private two-user feature test, before widening traffic.
5. If any critical step fails, stop rollout and preserve old deployment.

**Current release determination: NOT READY FOR FINAL SIGN-OFF.** Source-code review and limited checks are not a substitute for full tests or verified production behavior.
