# Tech Hub reliability pass and Timzee Corp email reference — 15 October 2026

## Reference inspected
Repository: \`Timzee00/timzee-corp-store-security-final\` (\`master\`), read-only.

Relevant code:
- \`BREVO-SETUP.md\` distinguishes API credentials and Supabase Auth SMTP credentials.
- \`public/assets/js/mail-client.js\` passes the signed-in user's access token to a protected mail service; it never accesses the Brevo key.
- \`supabase/functions/workspace-mail/index.ts\` authenticates current users, checks role-specific permissions, derives recipients from trusted workspace records, creates escaped branded HTML emails, and logs some provider outcomes.
- \`supabase/functions/workspace-digest/index.ts\` uses staff notification data to construct a restrained summary.

Differences retained for Timzee Tech Hub: Tech Hub uses Netlify Functions, a service-role-only staff reply reservation ledger, suppression checks, independent send gates, stricter rate limits, provider outcome reconciliation, and per-category consent. Those safeguards must not be overwritten by the Corp implementation. Brevo HTTP acceptance is not final delivery.

## Implemented in Tech Hub's development branch

1. \`netlify/functions/_lib/staff-email-template.js\`: accessible, branded, mobile-width transactional reply template with escaping and no injected markup in the recipient name.
2. \`netlify/functions/admin-reply-email.js\`: same server-side authenticated Brevo delivery; renders the new brand template, includes an explicit reply-to sender, and adds a **GET** audit-status endpoint. Sending still requires **both** \`EMAIL_DELIVERY_ENABLED=true\` and \`EMAIL_REPLY_ENABLED=true\`; read-only audit checks work while sending is paused. No client-provided recipient address is trusted.
3. \`assets/js/staff-mail-client.mjs\`: reusable browser wrapper sends the user's session token only. Sensitive keys remain server-only.
4. \`assets/js/admin.js\`: the Contact/Support/Advertising request modal now has **Reply with Brevo**, in-page editing and **Check reply status**. It stores the audit request ID in sessionStorage so a retry can be reconciled before any second attempt. Ambiguous/rejected outcomes don't auto-retry.
5. \`supabase/migrations/20261015031500_staff_reply_status_lookup.sql\` was applied. A service-role-only, actor-bound RPC returns limited audit status; it never returns reply text, recipient email or provider credentials.
6. \`netlify/functions/email-operations.js\` distinguishes every relevant RPC error using sanitized diagnostic codes instead of misleading "not activated" text. This will be available after the next build.
7. For You bug found through database schema review: \`video_likes.id\` and \`video_comments.id\` require client-supplied UUIDs. \`assets/js/fyp.js\` now supplies generated IDs for those inserts. Existing like and moderated comment behavior remains.
8. New tests: \`tests/staff-mail-reliability.test.cjs\` validates display-name/HTML escaping, read-only audit status, send gates and browser retry control; \`tests/fyp-database-contract.test.cjs\` checks video/post insert shapes and comment submission.
9. Existing \`tests/profile-market-fyp-brevo.test.cjs\` was updated to match consolidated diagnostics. \`npm test\` runs all new \`*.test.cjs\` automatically when CI can start.

## Checks done without real email, messages or deploys

- Live Supabase table-contract inspection confirmed \`video_likes\` and \`video_comments\` require explicit UUID values, while \`post_likes\` supports generated defaults.
- Role-based direct-message SQL checks were previously successful. No actual user message was sent.
- Private staff reply status migration applied successfully; no mail sent.
- Synthetic function invocation: POST with disabled mail gates returned HTTP 503 with zero provider calls. GET of a mock accepted reply returned HTTP 200 even while gates were disabled. Enabled POST with a mocked Brevo response returned HTTP 200 and used the recipient resolved from the database instead of a forged browser address. No network requests to Brevo were made.
- Synthetic UI helper checks: video like and comment payloads included explicit IDs and returned success. New/modified scripts passed JavaScript syntax validation.
- Prior Netlify requests to Email Operations showed 503 on aggregate/recovery/review RPCs, but Brevo connection verification was 200. The corresponding database RPCs worked in direct Supabase tests and were granted to service_role. A PostgREST cache reload was requested previously. Root cause of deployed Function 503 remains unconfirmed until a fresh request after rebuild.

## Remaining release acceptance

Not complete until a fresh Netlify Deploy Preview can be rebuilt and browser-tested. Credits were exhausted and no new build was requested. GitHub Actions were blocked by an account billing lock. Do not enable mail switches or mass send while this remains untested.

- Login as Super Admin / Admin and test inbox Reply with Brevo against a **controlled test email**; test status lookup after an accepted message and after a deliberately mocked timeout.
- Verify Brevo sender and reply-to address, delivered webhook update, suppression, quotas, password recovery, and separate marketing consent.
- Test moderator/admin/super staff chat opening a message without friendship; recipient reply, friend request separately, blocked user, privacy-disabled recipient, role demotion, new-message notification and old friendship chats.
- Test For You inline like/unlike, video comment, moderated post comment, playback and mute behavior in real Android Chrome.
- Test marketplace Contact Seller, profile image viewer, and responsive mobile carousel/footer; the Netlify drawer can be hidden by \`?ntl-drawer-state=hidden\`.
- Confirm Email Operations endpoint diagnostic codes in Netlify Functions and fix any actual returned code, rather than enabling sending to mask the error.

No secrets were copied between projects or disclosed. No live messages, campaigns or emails were sent. The development branch is \`fix/sitewide-shell-20261010\` (not \`main\`).

## Additional regressions repaired in this pass

- Existing `likeVideo()` helper in `assets/js/videos-marketplace.js` previously returned success without checking insertion and deletion errors. It now returns an explicit error and the Reels screen in `video.html` leaves like counts and notifications unchanged if the database write fails.
- `tests/video-like-safety.test.cjs` covers failed like and unlike operations; synthetic tests produced expected failure status without false UI state.
- Marketplace **Contact Seller** now persists `&contact=1` through login, reveals the previously hidden inquiry form for sellers who disabled direct chat, and uses the secure `can_send_direct_message` RPC to open legitimate ordinary or staff direct conversations before falling back to an inquiry.
- `tests/marketplace-contact-contract.test.cjs` verifies these navigation and inquiry safeguards. Supabase marketplace inquiry RLS was confirmed to allow buyers to insert and only the buyer or listing's seller to read the inquiry.
- Full tests remain pending a runnable GitHub Actions environment and fresh Netlify browser validation.
