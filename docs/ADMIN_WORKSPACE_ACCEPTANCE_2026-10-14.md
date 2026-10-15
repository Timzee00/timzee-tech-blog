# Admin workspace acceptance and scale review — 14 October 2026

## Implemented in PR #4 (unmerged)
- Super Admin post search and status filters; database page sizes of 12; public post preview links. Permanent delete still requires a confirmation; a recoverable archive workflow is a future migration.
- Super Admin user search through authenticated profile directory, 12-item pagination, profile detail link and existing verified/suspend/feature/staff actions. Only Super Admin can promote an existing registered account via server authorization.
- Fixed staff promotion search so it reads authoritative profile directory fields; secured create-admin to refuse demoting super accounts and verify Auth users by ID.
- Admin requests inbox detail modal exposes full fields without HTML execution, copy, and external mailto reply; replies are not stored or sent through the platform yet.
- Responsive compact cards and horizontally scrollable (rather than crushed) tables. Needs real device/browser verification.
- Opt-in browser traffic report: SHA-256 HMAC of randomly generated per-browser ID, one unique per UTC day, pageviews count separately, 7/30/90-day chart. Dashboard clearly explains counting conventions.

## Blockers before production
1. Review and apply `docs/sql/review-only-site-analytics.sql` to **isolated staging**; verify RLS and service-role grants, SQL execution plans, clock-boundary and opt-out behavior. This migration is not applied.
2. Create a **new strong random** Netlify Functions-only `ANALYTICS_HMAC_SECRET` (32+ chars) in the right deployment context. Do not reveal it in chat or frontend JS. A new deploy must include the functions.
3. Verification: opt out = zero events; opt in = first visit one browser daily + first pageview; refreshing raises pageviews but NOT daily uniques; next UTC date increments daily uniques; withdrawing consent drops local ID.
4. Backfill: impossible for visitor identities not previously collected. Do not show invented pre-install historical uniques or equate browsers/devices with real people. Browser-based dedup is imperfect for incognito, clearing storage, bots, shared devices. Add bot-abuse protections and retention policy before public deployment.
5. Staff directory search requires trigram/optimized index planning at 100k+ accounts; pagination uses offset (bounded page 10,000) and eventually needs cursor pagination. Rate-limit staff directory lookups; add full audit logs for moderation actions.
6. Replace permanent post deletes with staged removal, 7–30-day restoration, reason codes, audit records, content appeals and role approval. DO NOT run destructive production migrations just to simplify card UI.
7. True inbox collaboration requires staff assignments, internal notes, reply templates, response emails, audit trail, escalation and SLA timers. Current mailto reply opens an external email client and is not tracked.
8. Analytics needs server-side bot filtering, monitoring, retention/reconciliation tests and chart accessibility audit. Some public pages may not import site-shell.js and need measurement coverage checks.
9. Roll out the staged PR to isolated preview with protected staging database, run Node/browser tests and perform tests on a narrow Android viewport before merge.

## Suggested database indexes (review SQL in staging)
For large-scale substring search, consider `pg_trgm` GIN indexes on `profiles.display_name`, `profiles.username`, and `profiles.email` after measuring queries. An index on `posts(created_at desc,id)` improves paged posting queries. Index selection should follow EXPLAIN ANALYZE on anonymized staging data.

## Security
Do not expose service-role keys or analytics HMAC secrets. All staff directory, promotion and traffic report routes use authenticated, profile-authoritative server-side role verification. The frontend is not an authorization boundary.
