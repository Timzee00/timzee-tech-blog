# Screenshot triage: email, profiles, marketplace, For You — 15 October 2026

## Verified causes and evidence

1. Email Operations screenshot shows "Email stats not activated", "Manual review queue unavailable" and "Legacy recovery overview unavailable". Netlify's request logs for Deploy Preview 4 (Oct 14 23:46–23:48 UTC) confirm the authenticated email-operations Function **ran** but returned HTTP 503 for all three RPC paths. The Brevo credential verification returned HTTP 200 in the same timeframe. This is **not** evidence of a bad Brevo key.
2. The three service-only Supabase RPCs succeeded in direct read-only SQL verification with a simulated service role: `email_delivery_statistics`, `list_email_review_cases`, `legacy_user_recovery_overview`. This points toward PostgREST schema cache / deployed environment access, but does not yet prove the precise cause. A non-destructive `NOTIFY pgrst, 'reload schema'` was issued. No live authenticated browser retest has been performed.
3. A profile shows a literal HTML injection attempt as its display name, and a contact request includes similar HTML-looking test text. Current contact detail fields use `textContent`; HTML is untrusted data. Profile and marketplace display names now remove tag-shaped content and fall back to a neutral label; database evidence is not deleted.
4. Profile avatar and cover are static images and previously did not offer a large-photo viewer.
5. Marketplace's narrow mobile card layout broke seller names and verification badges across syllables, while contact navigation was hard to discover and could silently redirect.
6. For You was a three-column recommendation catalog. Video media linked away rather than rendering a player, and post/video like and comment actions were absent from the card.

## Changes committed to the development branch

- Profile: focusable avatar/cover image buttons + accessible closeable photo dialog with contained high-resolution image; clean rendered profile names.
- Marketplace: full-width single-column mobile cards; seller names and verified badge wrap naturally; direct **View details** and **Contact seller** card links; listing `?contact=1` initiates the existing WhatsApp/chat/inquiry decision flow, with visible feedback. The server still owns listing and buyer/seller eligibility.
- For You: full-width single-column social cards, native video elements with controls/playsinline, safe video metadata fetched from public video rows, existing post/video like tables, inline comment views and form submits using the existing Supabase RLS policies. Published-post comments remain moderation-gated; video comments use the existing video comment table. Horizontal filters scroll without compressing text. A full-content link remains available.
- In-site Brevo reply: staff Request Details no longer opens the mail application. Clicking **Reply with Brevo** opens an inline subject/message composer and explicitly confirms sending. The Netlify function `admin-reply-email` authenticates active admin/super users, derives the recipient exclusively from the original stored contact/support/advertising request, verifies suppression/rate limits through a private RPC, and audits an idempotency key with the outcome. A timeout or uncertain provider result is not auto-retried.
- Supabase migration `20261015024500_audited_staff_email_replies.sql` applied. Ledger is service-role-only with RLS; no replies have been sent. To activate after controlled E2E testing, both `EMAIL_DELIVERY_ENABLED=true` and a new `EMAIL_REPLY_ENABLED=true` would be required. Neither was changed by this development pass.
- Email Operations now distinguishes missing/outdated Netlify Function responses from expired admin access and uses sanitized error codes from Supabase to guide debugging, not misleading "not activated" language.
- Tests: `tests/profile-market-fyp-brevo.test.cjs` adds UI invariants, permission checks, inactive send gates, data minimization, and mocked provider acceptance. Syntax checks and synthetic spot checks passed for updated JS; full GitHub Actions is still blocked by GitHub billing.

## Release and safety boundaries

- **No Netlify deployment or email send triggered.** The user's hosting credits are exhausted and the current preview may still serve old frontend/functions. No production readiness claim.
- **No historical users were emailed or enrolled** in an inactivity campaign.
- No stored malicious-looking profile/contact records were deleted; they are treated as untrusted and displayed without HTML execution.
- Outstanding: authenticated browser E2E tests (like/unlike, comment moderation, video files, profile viewer, contact seller, Brevo reply, email stats), mobile viewport screenshots, retry/audit visibility, email deliverability, and fixing Netlify/GitHub credit and billing blockers.
- Note: Brevo HTTP 200 on `GET /v3/account` confirms credentials, not that delivery is enabled or a message will arrive.
