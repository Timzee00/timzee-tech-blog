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
