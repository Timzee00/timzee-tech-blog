# Timzee Tech Hub — transactional email rollout

## Status
Three SQL migrations are deployed to the live Timzee Tech Blog Supabase database and read-only access checks passed. The Netlify worker and webhook have **not** been verified on a published production deployment. Live email sending remains paused. Do not send campaigns until credentials, provider quota, consent, and suppression are verified.

## Required Netlify server-side environment
- `SUPABASE_URL`: project URL (Timzee Tech Blog)
- `SUPABASE_SERVICE_ROLE_KEY`: server-only secret key (never expose to frontend)
- `BREVO_API_KEY`: Brevo **transactional REST API** key, distinct from the SMTP password
- `BREVO_SENDER_EMAIL`: a sender verified/authorized in Brevo
- `BREVO_SENDER_NAME`: optional, defaults to Timzee Tech Hub

After updating Netlify environment variables, redeploy. Keep all keys out of GitHub and browser JavaScript.

## Already wired
- Database outbox triggers for newly inserted contact, support and advertising applications.
- Email IDs derived from immutable submission IDs to avoid duplicate enqueues.
- Scheduled Netlify worker runs once per minute, claims at most 20 jobs per run, sends via Brevo REST API, and stores its outcome.
- Backoff and up to six attempts for failed deliveries.
- No mail send occurs inside the frontend or database transaction.

## Known limitations — not production scale yet
1. Only contact/support/advertising acknowledgment templates are implemented. No newsletters, bulk campaigns, support replies, moderation notices, marketplace messages or security-alert triggers yet.
2. Brevo webhooks, suppression lists, complaint/bounce handling and subscription consent synchronization are not yet implemented.
3. A claim lease can expire after Brevo accepts a message but before result persistence. Retries can lead to a duplicate email. Provider-side idempotency strategy and reconciliation are required.
4. The worker's default upper bound is 20 jobs per minute (approximately 1,200 per hour, before failures), which is intentionally conservative. It is not sufficient for 100,000 simultaneous recipients.
5. There is no admin email operations console, per-event preference center, delivery-cost budget, or dead-letter replay UI yet.
6. The currently configured Brevo plan quota and API permissions need confirmation before live sends.
7. The database outbox, metrics, and suppression migrations were applied and verified on 2026-10-14; delivery remains disabled until Netlify is deployed and configured.

## Mandatory verification
1. Deploy SQL migration using approved Supabase workflow.
2. Confirm `private.email_jobs` exists and is inaccessible to `anon`/`authenticated`.
3. Confirm only `service_role` can execute public queue-claim and completion RPCs.
4. Submit one authorized test contact request and verify exactly one queued job.
5. Run worker with test-only verified recipient; check job status and actual Brevo delivery logs.
6. Verify email bounce and opt-out handling before enabling broader recipient classes.
7. Test concurrent workers, timeouts, failures, replays, quotas and fraud protection.
8. Add load tests and SLOs before committing to million-user capacity.

Do not put the Brevo SMTP password in `BREVO_API_KEY`. They are different credentials.


## Next-stage controls added
- `EMAIL_DELIVERY_ENABLED=true` is a mandatory server-side kill switch. By default, the worker exits without sending.
- Worker batch reduced to three jobs, with eight-second per-request timeout, to limit the duration of scheduled serverless runs.
- Super-admin-only read-only console at `/super/email-operations.html` uses a guarded Netlify API.
- `20261014201500_email_delivery_statistics.sql` adds service-role-only aggregate metrics. Apply **after** the initial outbox migration.
- Metrics do not include personally identifiable recipient addresses.

## Production activation order
1. Set up Brevo REST API key and verified sender securely in Netlify environment.
2. Apply the two SQL migrations through an approved database deployment path, and check security advisors.
3. Deploy and verify serverless execution while `EMAIL_DELIVERY_ENABLED` is unset.
4. Verify new form submissions enqueue jobs without browser access to the private table.
5. Test the worker in a controlled verified-recipient environment before setting `EMAIL_DELIVERY_ENABLED=true`.
6. Verify Supabase Auth SMTP separately from the Brevo REST worker.
7. Implement bounce/complaint suppression, unsubscribe/consent, provider reconciliation, and capacity testing **before** any large campaigns.

## Current live database verification
Later on 2026-10-14, all three SQL migrations were applied successfully. Read-only verification confirmed the outbox and statistics RPC exist, database RLS is enabled, and anonymous/authenticated users cannot call claim/metrics/suppression RPCs.


## Live infrastructure status (2026-10-14)
- Supabase project: `duvbcwwprkzzyzikmcol`
- Database migration `transactional_email_outbox`: **applied**
- Database migration `email_delivery_statistics`: **applied**
- Database migration `email_suppression_controls`: **applied**
- Confirmed three active triggers on contact, support, and ad submissions.
- Verified empty queue immediately after deployment; no unsolicited sends.
- Netlify project `timzee-tech-blog`: `EMAIL_DELIVERY_ENABLED=false`, sender email and sender name set for Functions in production.
- Netlify now lists `BREVO_API_KEY`, but its value has not been authenticated against Brevo in the worker. `BREVO_WEBHOOK_TOKEN` is still missing. Both must be secured with appropriate Functions scope before activation.
- Source code for the worker and webhook is committed on `main`; Netlify reported an older deploy-preview build sourced from `fix/sitewide-shell-20261010`. This branch is 163 commits ahead of their merge base while `main` has separate email work. **Do not overwrite this work with a blind branch switch/merge**; safely integrate via reviewed PR.
- Transactional Brevo webhook to register in Brevo after deployment: `https://timzee-tech-blog.netlify.app/.netlify/functions/brevo-webhook`. Choose type `transactional` and events hardBounce, spam, invalid, blocked. Use Brevo's bearer-token authentication matching `BREVO_WEBHOOK_TOKEN`; do not put it in the URL.
- Keep worker disabled until the admin-only dashboard, quota limits, provider API key, anti-abuse safeguards, and live test receipt are verified.

## Security advisor findings
- RLS-without-policy on private queue/suppression tables is intentional (service role only); public system_job_status is separately server-only.
- Supabase Auth leaked-password protection was flagged disabled. Enable in dashboard where plan permits.


## Integration branch and verification (2026-10-14)
- Active sitewide redesign: `fix/sitewide-shell-20261010` (PR #4 into `main`).
- Email staging: `feature/email-delivery-sitewide-20261014` (draft PR #5 into the sitewide redesign branch).
- Ported the email worker, admin API/page, webhook, and three SQL migrations without overwriting redesigned files.
- Added a dedicated reset-email form and PKCE recovery guard to the sitewide login implementation.
- Netlify environment-variable metadata confirms `BREVO_API_KEY` is available to Functions, but reports `is_secret=false` and broad scopes (builds, functions, runtime, post-processing). Treat this as a security configuration problem until an owner rotates/recreates it as a secret scoped only to Functions.
- API attempts to create `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, and `EMAIL_DELIVERY_ENABLED=false` returned success, but repeat Netlify listings did not show those keys. **Do not assume these are actually configured.** Live delivery still fails closed by code when the enable flag is not exactly `true`.
- The code's worker limit defaults to 50 emails per rolling 24-hour window (maximum configured 250), reserving the Brevo free plan's 300/day shared capacity for Auth SMTP.
- Static syntax checks and mocked worker tests passed: disabled path, missing configuration, quota exhaustion, suppression, and successful provider response/queue completion. No real email has been dispatched.
- The Brevo webhook can be configured with Bearer authentication via `auth.type=bearer` in the Brevo webhook configuration. A unique random `BREVO_WEBHOOK_TOKEN` must be configured in Netlify first, then Brevo; never use the API key as webhook token.
- Necessary before release: merge/review PR #5, validate Netlify deploy on correct branch, secure key storage, sender variables, webhook secret/configuration, one authorized receipt to a controlled inbox, then decide whether to enable worker.


## Staging integration milestone (2026-10-14)
- PR #5 merged into `fix/sitewide-shell-20261010` as commit `1d5d61c73a2f8793a8fd480932714fe0e4557c89`, not into `main`.
- Netlify confirmed successful preview deployment of the integration branch at `https://deploy-preview-5--timzee-tech-blog.netlify.app`.
- Read-only browser testing confirmed Forgot password opens an email-only form at desktop and 375px/320px mobile widths, with no horizontal clipping.
- Brevo worker now uses an `Idempotency-Key` header on outbound requests and a one-job-per-invocation limit.
- Pilot throttling migration `20261014223000_public_email_receipt_throttle.sql` deployed in Supabase: one receipt per recipient/template/hour and at most 150 queued public receipts per rolling 24 hours. These thresholds are intentionally temporary, **not** million-user capacity.
- Brevo webhook accepts provider event `invalid_email` as well as `hard_bounce`, `spam` and `blocked`.
- Regression tests added, but GitHub Actions workflows could not execute because GitHub reported: "The job was not started because your account is locked due to a billing issue." Fix GitHub billing before treating CI as green.
- `BREVO_API_KEY` is configured on Netlify and sender email/name match Brevo, but account metadata marks the API key non-secret; user elected to retain visibility, so protect Netlify account permissions and consider future rotation.
- `BREVO_WEBHOOK_TOKEN` and provider webhook configuration are still required. `EMAIL_DELIVERY_ENABLED` is absent in Netlify listings, so the worker's code-level fail-closed gate remains OFF.
- End-to-end sending and webhook delivery are not yet verified. Leave automated transactional sending paused.


## Safe Brevo authentication diagnostic
- The super-admin page `/super/email-operations.html` now has a **Verify Brevo connection** control.
- It calls the protected `email-operations?verifyProvider=1` endpoint, which authenticates the current user as a super admin and makes a read-only GET to Brevo's account API using the server-side key.
- It does not send email, reveal the API key, or change Brevo settings.
- Local sandbox simulations checked unauthenticated access (401), non-admin access (403), good Brevo credentials (200), and rejected Brevo credentials (503). The new regression tests are committed, but GitHub Actions remains unable to start because of the account billing lock.
- Current Supabase outbox count is zero, with no sent, pending or failed transactional receipt jobs (read-only check on 2026-10-14).
- Once the staging branch is deployed with the new function, a super admin can verify Brevo credentials before adding webhook authentication or sending a controlled test message.
