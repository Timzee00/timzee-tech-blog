# Blipmood Identity & Recognition — Implementation and Release Gate
**Implementation date:** 2026-10-29
**Repository:** `Timzee00/timzee-tech-blog`, branch `main`
**Status:** committed and database migrations applied; production deploy and Lighthouse validation BLOCKED pending CI/Netlify access.

## Built components
- Individual checkmark uses an original Blue icon; legacy Silver/Gold/Platinum entitlement codes remain protected in the existing database, and these verified individuals share the Blue public identity check. Existing business status keeps an organization badge.
- Verification and organization affiliation explanations are accessible by click and keyboard via one delegated event listener; verification-date is read from trusted public data.
- Account transparency details on profile pages show joining history, verified date, company affiliations, official Advisor/Product Lead appointments, Staff Picks/Featured/Platinum/Product Contributor distinctions. Older legacy awards are explicitly marked historical, without inventing a justification.
- Existing six portrait frames preserved. Added `constellation`, `crest`, and `nameplate`; the nameplate displays the person's current profile name in a responsive portrait ribbon.
- Public-profile organization badge/logo uses DB-controlled, denormalized `primary_org_*` fields so feed, comments, chat identity lookups reuse their existing batched queries; no per-author affiliation fetch. Pending and revoked affiliations never populate the public cache.
- Company invitations are private until accepted; staff can review organizations with a documented reason, invite members and revoke individual affiliations. Audit history is written to a private schema.
- Product Lead, Product Advisor, Community Advisor and Community Contributor are appointments, not verification or moderator authority.
- Advisor self-application page `advisor.html` with private evidence, status, review history. Super Admin has a bounded review queue and atomic server-controlled approval/rejection.
- Staff Pick, Featured, Platinum and Product Contributor awards support rationale, author, timestamps, optional expiry, and withdrawal. In-app notifications fire only on reviewed state changes.
- Public `verify.html` explains a free Blue individual verification application, with real account age and reputation points. Account activity alone cannot issue a blue check.

## Files
- `assets/js/verified-identity.mjs`: canonical renderer, badges, company marks, explanations, frames.
- `assets/css/verified-identity.css`, `assets/css/profile.css`: cosmetics/accessibility/responsive.
- `assets/img/blipmood-verified-blue.svg`: optimized original badge.
- `profile.html`, `assets/js/profile.js`: profile transparency and UI.
- `verify.html`: existing review form updated for Blue individual verification.
- `advisor.html`, `assets/js/advisor-applications.mjs`: private Advisor application.
- `super/identity-recognition.html`, `assets/js/identity-recognition-admin.mjs`, `super/professional-panel.html`: staff management/review.
- `assets/js/data.js`: company affiliate mark in existing comment-author profile batches.
- `tests/blipmood-identity-recognition.test.cjs`, `tests/verification-frame-collection.test.cjs`, `package.json`: regressions in production build gate.

## Applied Supabase versions
1. `20261029133242_blipmood_identity_recognition_20261029.sql`
2. `20261029133351_expand_verified_frame_styles_20261029.sql`
3. `20261029133742_audited_organization_review_20261029.sql`
4. `20261029134521_identity_targeted_fk_indexes_20261029.sql`
5. `20261029134835_identity_affiliation_public_batch_cache.sql`
6. `20261029135139_identity_advisor_applications_review.sql`
7. `20261029135612_identity_review_notifications.sql`

The GitHub migration filename version stamps match the versions reported by Supabase, preventing duplicate-file drift in future migration tools. No original `profiles` verification tiers, permissions, or existing data were deleted.

## Checks completed
- Supabase reported success for all seven additive migrations.
- Database check: public identity RPC returns a valid bounded empty JSON structure; four core identity tables have RLS, and public anonymous roles cannot invoke staff-only review RPCs.
- PostgreSQL BEGIN/ROLLBACK tests passed for adding/revoking company affiliation and for identity lifecycle notifications (8 events); rollback confirmed to leave no synthetic data.
- Basic JS syntax checks passed on the touched modules and inline verification script.
- Ten targeted badge/renderer checks passed.
- Nine identity-recognition regression test cases passed in an isolated JS test harness. They are included in the repository's production `npm run check` script but the complete Node/Playwright suite has not been verified on CI.

## Blockers — do NOT claim a live release yet
- Latest Netlify published deployment remains locked at commit `87c631b6b92bdf7bc59a050226fa80e09b738007`, dated October 28, 2026; it is older than this implementation.
- GitHub Actions Production gate runs report failure before any steps start (no runner steps or test log available), consistent with the account's billing/runners restriction. This does NOT prove a failing code test, but it prevents confirmation.
- Browser Use could not open Netlify deployment previews because the connected Browser Use project reports insufficient credits.
- There is **no grounded post-change Lighthouse score**. Do not claim a 90+ score, or that mobile / browser E2E testing passed.

## Safe production release checklist
1. Confirm GitHub Actions billing/runners are usable. Run `npm run check`, `npm test`, and `npm run build` successfully on the current `main` head.
2. In Netlify -> Blipmood -> Deploys, resolve the locked production deploy and generate a Deploy Preview / fresh branch build of the current commit. Inspect build logs for HTML, CSS, JS, functions, and absence of missing assets.
3. Test one unverified account, Blue-verification account, organization account, inviter/recipient pair, Advisor applicant/reviewer, and super administrator. Exercise invite -> accept -> display -> revoke and approved/rejected Advisor paths; verify no privilege escalation or private-document exposure.
4. Run actual Lighthouse **mobile and desktop** on the new deploy preview for home, profile, verification and advisor routes. Track Performance, Accessibility, Best Practices and SEO, plus LCP/CLS/INP. Repair any regressions before publishing; never fabricate scores.
5. Check feed, reels, chat, group moderation, comments, notifications, profile editor and account security before unlocking public release.
6. Publish only after the evidence above is green. If a UI regression occurs, roll back the front-end commit to the previously published build; because database tables are additive, avoid dropping them or deleting member awards/data during rollback.

## Intentional limitations
- Earned verification is a free reviewed path; automatic point-based badge issuance is NOT enabled, to prevent fraud and misleading authenticity labels.
- Existing creator tier perks remain separate from verification badge appearance; no subscription billing rules changed.
- The app is not guaranteed bug-free without live integration testing. This document records verified evidence and explicitly distinguishes unfinished release gates.
