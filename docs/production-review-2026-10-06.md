# Production review — 6 October 2026

**Decision: not approved for a millions-user launch.** This change fixes verified code defects and adds repeatable release tests. It does not establish production database safety, restore capability, or load capacity.

## Evidence and scope

- Repository: `Timzee00/timzee-tech-blog`; reviewed base `ca2e9ee` on `main`.
- Live site: https://timzee-tech-blog.netlify.app . Homepage and `/health` returned HTTP 200 during this review. Health reported database/automation/private chat media OK, but `version: "unknown"` and no deploy ID.
- Netlify site `e6df06ad-753f-4237-813a-4794840362f8` reports published deploy `6aac3cddef1b56000836ded5`, **locked**, at commit `4e823e8fa531a1ef26d0f531791dcac8ad23b850`, published 17 September 2026. That is 54 commits behind the reviewed `main`. Do not unlock it and deploy all intervening changes without staging validation.
- Live `/assets/js/app.js` returns `Cache-Control: public,max-age=31536000,immutable`; its filename is stable. Live `/SUPABASE_SCHEMA.sql` returned HTTP 200, confirming that the public deploy contains repository material.
- The code references Supabase project `duvbcwwprkzzyzikmcol`. The Primary connector returned an unavailable-tool error. The other connection listed different projects; none was this project. No production database mutations, private-data reads, authenticated live exercises, load tests, or deploy changes were made.
- Source inspection covered build/configuration, Netlify handlers, authentication helpers, rich HTML rendering, chat, and tracked SQL migrations. This is a focused review, not an exhaustive security certification.

## Findings fixed in this change

| Severity | Finding and precondition | Impact | Fix and verification |
| --- | --- | --- | --- |
| High | `assets/js/utils.js` used a custom fallback when DOMPurify was absent; no page supplied DOMPurify. Rich content could retain iframe/srcdoc, unsafe URL forms, and other active HTML. | Stored content could execute code or display hostile controls in a reader's session. | Use pinned DOMPurify from the local public build, exclude non-HTML profiles, forms, inline style and srcdoc. Desktop/mobile browser tests exercise malicious markup and preserve safe formatting. |
| High | `_lib/auth-role.js` fell back to privileged auth metadata when the authoritative profile lookup failed and did not inspect account status. | A stale role could retain privileged endpoint access during a database failure or suspension. | Deny missing/unavailable/inactive profiles; use the current profile role. Unit tests cover demotion, suspension, missing identity and database errors. This does not prove suspension enforcement in every database policy or AI route. |
| High | `chat-media-sign.js` accepted a message association without requiring its sender to own the referenced storage path. | A forged association could become an authorization path if other database controls allowed it. Live exploitability was not tested. | Filter by the path owner as sender before recipient/membership authorization. Tests check denial and valid member signing. Live message-insert policies still require review. |
| High | The latest security migration had `as $ ... $;` instead of a valid dollar-quoted function body. | Applying it fails; intended security rules cannot be assumed deployed. | Correct the delimiters and parse all 21 migrations with PostgreSQL's parser. This validates SQL statement syntax, not PL/pgSQL semantics, object availability, or policy behavior. |
| Medium | Stable JS/CSS URLs were immutable for one year. | Returning users could continue running old code after a security or compatibility fix. | Revalidation headers plus a build-content version on HTML, JS module, dynamic import, and CSS import references. Browser tests check matching asset versions. Already-open tabs must reload. |
| Medium | Netlify published the repository root; no committed dependency lockfile or build gate. | Operational SQL/source/documents were unnecessarily served; transitive dependencies could change between builds. | Build an allowlisted `dist/`, commit the lockfile, serve locally bundled Supabase/DOMPurify, and publish `/release.json`. Tests check public assets and excluded paths. |
| Medium | Several mutation handlers crashed on JSON `null`; AI base64 bodies were not decoded; rate-limit results without a boolean decision were accepted. | Unhandled errors and unreliable input/rate-limit enforcement. | Shared bounded object parser, safe base64 handling, strict rate-limit decisions, provider timeout and generic upstream errors. Handler regressions cover these cases without real services. |
| Medium | Role synchronization ignored returned Supabase errors; admin creation ignored failed profile writes. | UI could report successful role changes when account state remained inconsistent. | Return failure for these writes; test returned errors. Cross-service role changes still are not atomic; repair/reconciliation is an outstanding requirement. |
| Medium | Chat requested ascending history without pagination. | Long conversations could show the oldest API page and omit recent messages. | Load the newest 50, order stably by timestamp/id, and offer older pages using a cursor; preserve scroll position. Browser tests exercise both pages. |
| Medium | Concurrent chat sends and switching conversations during an upload could use changing state. | Duplicate sends or sending an attachment to the newly selected recipient. | Serialize an in-flight send and capture its recipient, thread, and attachment before awaiting upload. Browser tests cover duplicate submissions; an upload/switch integration exercise remains in staging. |
| Medium | Mobile CSS hid the signed-out chat login prompt. | Mobile visitors saw an empty chat list instead of a way to log in. | Add a visible signed-out layout; test both viewport sizes. |
| Low | Shared shell assets/legal links resolved relative to nested admin paths; policy pages failed the release check. | Broken assets/navigation; CI failure. | Resolve shared shell links from the site root and include the business operator on the two policy pages. |
| Low | `/health` counted all profiles for a simple connection probe. | Monitoring creates unnecessary database work as user count grows. | Remove the exact profile count. The legacy-media diagnostic still needs a measured query plan at scale. |

All confirmed code findings above have high confidence. The chat-media attack path is a defense-in-depth finding whose live prerequisites remain unverified.

## Remaining launch blockers

1. **Release drift and deployment lock.** Review the 54 intervening commits and this PR in a staging deployment. Confirm a known previous release can be restored. After approval, deploy an exact commit and compare it with `/release.json`. Keep staging backend credentials separate: the current frontend still hardcodes the production Supabase URL/key, so a preview alone is not an isolated staging environment.
2. **Database baseline and authorization evidence.** Tracked migrations start by altering/indexing tables that they do not create. They are incremental patches, not a replayable new-project baseline. Obtain a redacted schema baseline and migration ledger from the correct project, then exercise an empty restore and an upgrade against a disposable Supabase environment. Review Data API grants, RLS on every exposed table, views, SECURITY DEFINER execute rights, protected profile fields, private chat membership and Storage policies with anonymous/user A/user B/moderator/admin identities. Run security/performance advisors. Do not infer these settings from frontend projections.
3. **Maintenance failure and cleanup correctness.** `automation-maintenance.js` calls `.from("storage.objects")`, which addresses a relation through the default PostgREST schema, not the Storage API. Its cleanup relies on two limited 5,000-row result sets to infer that objects are unreferenced, which is unsafe if either set is truncated. It runs before `process_automation_tick`, so a failure prevents the core job. Validate the actual deployed job and storage API, separate migration/cleanup from recurring publishing, and use complete reference checks before any deletion. No deletion algorithm was changed or run in this review.
4. **Realtime chat semantics and privacy.** `subscribeRealtime()` creates a random channel name per client, so typing/presence cannot reliably be shared by participants. A stable channel must first have private-channel authorization and membership tests; simply removing randomness would expose a predictable public channel. Reconnect/update/delete behavior, read receipts, blocked users, and media refresh need authenticated multi-user E2E testing. The new paginated query should have a verified `(thread_id, created_at, id)` index and query plan.
5. **Workload and query limits.** Several directories/admin searches are capped to the first 1,000–2,000 auth users; chat previews/friendships and other lists lack complete pagination. Global announcement delivery uses a cross join with all profiles in the automation RPC; millions of notifications need bounded batches/queues, idempotency, retry/backoff, and measured throughput. The per-user AI limit is useful but does not set a global provider budget or constrain mass signup abuse. Establish provider quotas and cost limits.
6. **Operational proof.** Verify backups/PITR and perform a timed restore, set uptime/error/latency/job-lag/cost alerts, define an incident owner, review service quotas and regions, and exercise a rollback. Netlify's existing Lighthouse result (performance 63, accessibility 88) is historical deployment metadata, not a fresh audit or evidence of throughput.
7. **Full functional coverage.** Current browser tests use isolated fixtures and Chromium desktop/mobile emulation. They are not live authenticated E2E, Firefox/WebKit/device testing, mail/OAuth/payment delivery tests, or a complete accessibility audit. Exercise login/recovery, two-user authorization, posting/moderation, uploads and expiry, marketplace, novels/videos, public forms, and AI success/failure cases in staging.

## Capacity acceptance plan

“Millions of users” does not specify simultaneous users or request rate. Treat it as a large audience target until daily active users, peak concurrency, geography, action mix, media volume, and budget are defined. Do not promise millions of concurrent users from static-CDN capacity.

- Build an isolated, production-like staging environment with representative data sizes (including million-row profiles and realistic messages/content) and agreed spend limits.
- Measure cached page reads separately from uncached API reads, authenticated writes, uploads/downloads, realtime fan-out, and AI calls. Mock paid providers during the main load test, then do a small quota-controlled provider integration test.
- Start with a smoke load, ramp in stages to the agreed peak, hold for at least 30 minutes, run a longer soak, then exercise a short agreed burst and recovery. Capture a timestamped report tied to commit, dataset, infrastructure tier and test script.
- Agree acceptance thresholds first; proposed starting targets are API p95 under 500 ms for ordinary reads, application 5xx under 0.1%, no authorization failures, duplicates or lost writes, bounded queue lag, and recovery without manual intervention. Treat AI/media latency separately.
- Watch database CPU/I/O/locks/pool saturation/query plans, realtime connections and fan-out, function latency/concurrency, bandwidth, provider 429s, and cost. Optimize demonstrated bottlenecks and repeat only the affected scenarios.
- Run restore and rollback drills and launch gradually with monitoring. No load test was run against production in this review.

## Validation

Executed locally on Node **22.23.3** after a clean `npm ci --ignore-scripts`:

- Production configuration and **93 JavaScript/inline-script syntax checks** passed.
- **38 handler/security/SQL tests** passed, including syntax parsing of all 21 tracked migrations.
- **16 Chromium desktop/mobile browser tests** passed, including rich-content sanitization, anonymous pages, the mobile chat prompt, long-chat pagination, duplicate sends, public-build exclusions and asset versioning. Backend responses were isolated fixtures.
- `npm audit` reported **0 known vulnerabilities** across the installed runtime and development dependency tree at review time.
- A pattern scan of tracked source and **641 historical candidate blobs** found no matches for the scanned provider-secret, private-key, or GitHub-token patterns. This is limited detection, not a guarantee that no secret has ever been committed.
- `git diff --check` passed.

The release workflow now repeats clean installation, source checks, public build, handler/SQL tests, runtime dependency audit, and browser regressions. Passing these gates does not resolve the launch blockers above.
