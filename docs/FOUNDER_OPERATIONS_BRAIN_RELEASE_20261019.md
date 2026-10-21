# Timzee Tech Hub — Founder Operations Brain (19 October 2026)

## Scope
A solo-founder, free-first moderation and operations layer built on the existing
Supabase role model, Netlify Functions and in-app notifications. It avoids paid
monitoring services, external AI classifiers, bulk content copies and new teams.

### Review inbox
- Open **Admin → Operations Brain → Founder review inbox**.
- Choose **Site reports**, **Community reports** or **Spam signals**.
- Every request is authenticated with the staff's existing Supabase session.
- `operations-inbox` verifies the current server-side `profiles.role` and
  `account_status` (admin/super and active) before reading with service credentials.
- Responses contain only the target reference, bounded reason or signal, timestamps,
  risk score where applicable, and pagination. They exclude reporter identities,
  private messages, verification documents and raw arbitrary metadata.
- Each queue returns 15 records per page, with at most 50 pages per query.
  Pages are filtered in PostgreSQL, not downloaded into the browser first.
- Site report decisions reuse the **existing** `moderate-content` transaction RPC,
  with a stable idempotency key on retry, and an audit receipt.
- Community report decisions reuse `community_review_report`.
- Spam-signal acknowledgements reuse `community_review_auto_flag`.
  Acknowledgement does **not** approve, remove or ban the underlying content.
- Postgres audit triggers record transitions for community reports/spam signals.
  Finalized reviews cannot be silently overwritten; future appeals need a separate
  explicitly audited workflow.
- Input from users is inserted with DOM `textContent`, never `innerHTML`.
  No continuous inbox polling occurs.

### Daily owner digest
- The existing `automation-maintenance` Netlify job invokes
  `process_founder_operations_digest` after core and verification maintenance.
- A **service-role-only** database function checks once the UTC clock reaches 08:00.
- Only active `super` administrators who have not opted out are eligible.
- It sends one in-app digest per UTC day **only if** site/community reports,
  spam signals, verification applications or overdue articles exist.
- The `founder_digest_deliveries(recipient_id,digest_day)` primary key makes
  overlapping schedulers and retries idempotent.
- Configure via **Settings → Notifications → Founder daily operations summary**
  on a super admin account. This is an in-app alert, not a Brevo email.
- No raw report reasons, identities or documents are placed into notifications.
- The notification opens `/admin/dashboard.html?tab=operations` after role
  authentication. Access is revalidated on every request.

### Database migrations applied to the live project
1. `20261019090000_founder_moderation_inbox_audit.sql`
2. `20261019091500_founder_digest_automation.sql`
3. `20261019093000_finalized_community_review_guard.sql`

Migrations create bounded partial indexes and server-side audit/lock triggers.
No data rows were deleted and no accounts were automatically verified, sanctioned
or promoted. Production frontend `main` is **not** updated by these migrations.

### Code boundaries
- `netlify/functions/operations-inbox.js` — staff role guard and paginated read.
- `assets/js/operations-triage.mjs` — rendering, confirmation, RPC dispatch.
- `assets/js/operations-console.mjs` — existing aggregate health dashboard.
- `assets/js/verified-identity.mjs` — existing shared verified identities.
- `netlify/functions/automation-maintenance.js` — one existing scheduler;
  digest is a no-cost add-on, not a new concurrent cron.
- `tests/operations-inbox.test.cjs`, `tests/founder-operations-digest.test.cjs`
  — permission checks, bounded results, digest safety and worker behavior.

### Release verification still required
1. `npm ci --ignore-scripts && npm run build && npm test` on Node 22.
2. Sign in as **super** and **admin**, verify queues and button behavior.
3. Sign in as a regular user and moderator, verify the owner inbox is denied.
4. With two review sessions, try to resolve the same report; at most one new
   audit entry and one final state must result.
5. Test 320px/390px/768px widths and keyboard navigation; ensure no scroll leak.
6. Verify the digest preference is preserved across devices, and both
   opt-out and once-per-UTC-day delivery hold with overlapping worker calls.
7. Confirm role demotion immediately removes the ability to view the inbox.
8. Verify verification-proof URLs and reporter identity fields never appear
   in any ops API response, logs or notification body.
9. Check migration history before attempting any replay in a staging database.

## Known deployment blocker
GitHub hosted workflows for PR #7 have failed and detailed runner logs were
unavailable from the connection. A failure might be caused by GitHub account
billing/runner limits; this **does not prove the code passed or failed tests**.
The Netlify site was previously paused due to credit limits. Do not label the
browser/UI build production-ready without the acceptance checks above.
