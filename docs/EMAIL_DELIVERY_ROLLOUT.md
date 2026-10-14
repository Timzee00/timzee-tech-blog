# Timzee Tech Hub — transactional email rollout

## Status
The GitHub migration and email worker are source-controlled, but **do not assume they are activated in production**. Apply and verify the migration through an authorized Supabase deployment workflow; do not send public campaigns until provider, limits, and suppression are verified.

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
7. The migration needs authorized database deployment and read-only verification; it was **not** applied automatically.

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
A read-only database check on 2026-10-14 returned no `private.email_jobs` table or statistics RPC. The migration must not be described as deployed.
