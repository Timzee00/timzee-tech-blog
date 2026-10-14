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
- Scheduled Netlify worker runs once per minute when deployed and enabled, claims at most 1 job per run, sends via Brevo REST API, and stores provider acceptance separately from delivery confirmation.
- Backoff and up to six attempts for failed deliveries.
- No mail send occurs inside the frontend or database transaction.

## Known limitations — not production scale yet
1. Only contact/support/advertising acknowledgment templates are implemented. No newsletters, bulk campaigns, support replies, moderation notices, marketplace messages or security-alert triggers yet.
2. Webhook and suppression code exists, but real webhook activation and end-to-end delivery are unverified. Marketing subscription consent synchronization is not implemented.
3. Ambiguous provider outcomes are now held for manual reconciliation to prevent blind automatic resends. Brevo documents a 30-minute idempotency TTL. Human review, provider reconciliation and controlled replay UI are still required.
4. The pilot worker is intentionally capped at one claimed job per invocation and 50 sends per rolling 24 hours by default. This is not sufficient for 100,000 active recipients.
5. A read-only super-admin aggregate email operations console exists in GitHub; an end-user preference center, cost budget, and manual reconciliation/replay UI are not yet implemented.
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


## Credit-free development checkpoint — October 14, 2026
User's Netlify credits are exhausted. Continue improving source code and connected Supabase infrastructure, but do **not** trigger a new Netlify deployment, change the public production site, or send a live email without a controlled release window. Existing deploy preview is a snapshot and does not include subsequent commits until Netlify rebuilds it.

- GitHub development branch: `fix/sitewide-shell-20261010` (PR #4 remains unmerged into main).
- Supabase migration `email_delivery_event_journal`: applied. Private `email_provider_events` stores provider message IDs, event kinds, and timestamps (not message bodies or recipient emails).
- Supabase migration `quarantine_uncertain_email_delivery`: applied. Unexpected network outcomes, duplicate-parameter responses, and other uncertain results are held as failed jobs requiring manual reconciliation; no blind retry.
- Supabase migration `email_reconciliation_metrics`: applied. Aggregated super-admin statistics separate Brevo-accepted, confirmed delivered, rejected/bounced, and held-for-review jobs.
- Netlify webhook code recognizes Brevo's documented hard_bounce, spam, blocked, invalid_email, delivered, soft_bounce and deferred events. It normalizes ts_event/ts seconds and ts_epoch millisecond timestamps.
- Brevo send request uses documented `headers.idempotencyKey` (UUID), whose server-side provider protection is documented for batch transactional emails and has a limited TTL. It is an extra defense, not a permanent guarantee for single-message sending.
- Synthetic/mocked checks passed for provider-accepted, network failure, duplicate-parameter response, 429 rate limit, timestamp conversion, and incorrect webhook token. These checks did **not** contact the real Brevo API, and GitHub Actions remains blocked by an account billing issue.
- Read-only SQL checks: no queued email jobs, no webhook journal rows. Service role can execute privileged recording and quarantine functions; anonymous and normal authenticated accounts cannot.
- Review queue UI, email preferences, webhook monitoring, monthly budget guard, retention policy, provider-event replay tests, and full 100,000-active-user load testing are future work.
- Supabase Security Advisor still warns `auth_leaked_password_protection` is disabled. Review when the Auth plan/features permit. RLS without policies on private email tables is intentional.
- Existing Netlify environment has `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME`, `BREVO_WEBHOOK_TOKEN`; the key/token were not marked secret in earlier account metadata. Never print or expose their values in logs, screenshots, or code.
- Keep `EMAIL_DELIVERY_ENABLED` unset/false until the updated Netlify branch is deployed, webhook authentication is verified, credentials and quota are tested, and a user-approved recipient receives exactly one test email.


## Manual reconciliation and optional email preferences (October 14, 2026)
Deployed to Supabase:
- `email_manual_review_audit`: private append-only review actions and service-role-only list/record RPCs. Actor and rationale are stored; review does not change job status or trigger retries.
- `email_notification_preferences`: optional message, mention, marketplace, and community email choices; all default `false`, with authenticated users limited to their own row via RLS.
- `email_review_stats_refinement`: separates unresolved quarantined jobs from closed human reviews.

Source-controlled only (requires a **future** Netlify build once credits return):
- Super-admin `/super/email-operations.html` displays up to 25 unresolved quarantined jobs, accepts an explicit decision and a 15–1000 character review note, and requires confirmation before saving.
- Super-admin-only Netlify endpoint validates JWT and authoritative active profile role, records the actor ID from verified auth, and provides masked/redacted case details without address or message payload.
- User Settings page has four independent optional email switches with accurate warning that no optional email feature is live yet. Security and password recovery emails are separate and continue independent of preference switches.
- Added regression tests covering authorization, no sending, data minimization, preferences, and RLS scripts. GitHub Actions cannot run while the account billing lock remains in place.

**Safety and operational limitations:**
- No replay/resend button exists. Admin review is only a case record; confirmed status currently depends on human evidence rather than automatic Brevo verification.
- The provider webhook and latest Netlify endpoints have not been deployed to the actual public domain in this credit-limited session.
- Email worker remains fail-closed because `EMAIL_DELIVERY_ENABLED` must be exactly `true` before any sending.
- No optional digest or marketing email is generated yet; marketing requires a separately implemented and audited consent flow.
- Review note may include evidence but should never contain raw API keys, passwords, or unnecessary personal data.
- New database objects are private or row-scoped; server service role remains solely in Netlify functions.


## Opt-in digests — implemented, dispatch OFF (October 14, 2026)
- Supabase migrations `opt_in_digest_preparation`, `digest_consent_recheck`, and `digest_scheduler_null_guard` applied to `duvbcwwprkzzyzikmcol`.
- `public.prepare_email_digests(p_dry_run boolean default true,p_limit integer default 10)` is service-role only. It categorizes unread notifications, considers only verified users with active profiles and explicit per-category opt-ins, checks suppressions and previous 24h jobs, and never enqueues in dry-run mode.
- Live dispatch also requires `private.email_digest_controls.enabled=true`. This is **false** in production; pilot daily digest queue cap is 20.
- Netlify worker `email-digest-preparer.js` is scheduled for 08:00 UTC when eventually deployed but fails closed unless BOTH `EMAIL_DIGEST_ENABLED=true` and `EMAIL_DELIVERY_ENABLED=true`. Neither has been enabled during credit-free development.
- Email worker supports `message_digest`, `mention_digest`, `marketplace_alerts`, and `community_digest` with counts only: no raw chat, post, marketplace, or notification content is emailed. An account-settings link supports future opt-out.
- Every optional digest job is rechecked against the user's current category consent and active/verified account status immediately before Brevo; unauthorized jobs are suppressed without network sending. A preference UPDATE also cancels pending disallowed digests.
- The protected super-admin dashboard has an eligibility preview that only returns counts and never enqueues or sends.
- Synthetic checks: absent gate does not contact Supabase, revoked consent causes no Brevo request, valid consent reaches a mocked provider once, consent RPC failure refuses to send. Real Brevo delivery has not been tested.
- Read-only verification: SQL dispatch flag false, 20/day cap, 0 opted-in users, 0 queue jobs, anonymous/authenticated roles cannot call the scheduling RPC; dry run returned 0 groups, and disabled dispatch enqueued 0 jobs.
- The scheduler is a **pilot**, not a 100,000-active-user solution. Production-scale work requires cursor-based eligibility evaluation, provider-aligned batching/quotas, monitoring and load tests, email one-click unsubscribe or equivalent consent UX, auditability, retention and operational controls.
- Because Netlify credits are exhausted, do not trigger a build or publish the new worker until the user explicitly requests a deployment. The existing preview does not include these new commits.


## Workflow status and inactivity email automation — 2026-10-14
Deployed to Supabase (all migrations are source-controlled):
- `workflow_status_email_triggers`: AFTER UPDATE OF status on support, advertising applications, verification applications, and content reports. Only recognized outcomes are queued; no raw support text, verification documents, or moderation evidence are included. Staff RLS is authoritative. The same status/id gets a single email job.
- `opt_in_inactivity_reminders`: user-owned `inactivity_reminders` preference defaults false. Private, one-row-per-user visit tracking. `public.record_my_site_visit()` is authenticated-only and server-rate-limited to one write per six hours. Dormant accounts from before deployment are **not** automatically emailed. Requires a genuine visit after opting in.
- `send_time_status_and_inactivity_checks`: service-only checks prevent stale status decisions, recently returned users, suspended accounts, or opted-out recipients from receiving queued mail.
- `inactivity_one_click_opt_out`: a service-only job-scoped function to disable check-in mail and suppress pending reminders.
- Campaign settings `private.inactivity_campaign_controls`: **disabled**, inactive-after 30 days, temporary pilot cap 10 enqueues/day. A successful enqueue marks the inactivity episode to prevent repeat nags until the user revisits.
- Read-only SQL verification: four workflow status triggers active, opt-in stamp trigger active, no queued jobs, no opted-in users, campaign flag false. Anonymous/normal members cannot prepare campaigns or call service-only unsubscribe RPC.

Source changes requiring a **future** Netlify rebuild:
- Sitewide Supabase client reports signed-in, visible-page member visits; browser and database both throttle writes. Public/anonymous visitors do not use this visit tracker.
- Settings > Email updates has a dedicated, opt-in-by-default-off reminder toggle explaining the 30-day absence threshold.
- `email-inactivity-preparer.js` has a daily schedule (08:30 UTC) but will **not queue** without `EMAIL_DELIVERY_ENABLED=true`, `EMAIL_INACTIVITY_ENABLED=true` and the separate Supabase campaign flag. All are currently off or unset.
- `email-worker.js` now contains generic status-change templates and friendly reminder copy, verifies authorization immediately before sending and avoids exposing sensitive user content.
- `unsubscribe.html` and `email-opt-out.js` allow no-login opt-out with a signed, job-scoped, 90-day token and no-referrer policy.
- `email-operations?inactivityPreview=1` enables a super-admin-only dry-run aggregate preview; does not queue jobs.
- `tests/email-workflow-and-inactivity.test.cjs` covers defaults, disabled gates, stale status, a returned user, and tampered unsubscribe tokens. GitHub Actions remain locked by account billing, and the local environment could not clone GitHub. Source syntax checks passed, but this is not equivalent to an integration test.

New **required secret before enabling**:
- `EMAIL_UNSUBSCRIBE_SECRET`: distinct randomly generated secret (at least 32 characters) stored only as Netlify Functions secret, preferably from a secure password manager. Never reuse the Brevo SMTP key, Brevo API key, or webhook bearer secret. Generated token signing fails closed if the secret is missing. The opt-out endpoint must be deployed alongside the sender before activation.
- Keep `EMAIL_INACTIVITY_ENABLED` unset/false and `EMAIL_DELIVERY_ENABLED` unset/false until test emails, unsubscribe workflow, credentials, and provider webhooks have been verified.
- The check-in is **optional re-engagement**, not a necessary account message; never opt users in silently or use their email for marketing without consent. Brevo manages standard list-unsubscribe headers but the body has a direct preference-off link too.
- Do not backfill historical users or manually queue live reminders. The preview branch is a static deployed snapshot and won't contain any of these changes without a new Netlify build. Current hosting credits are exhausted.
- Scale note: current scheduler is deliberately limited and not proven at 100K concurrent users. Add indexed keyset scanning/queue capacity and suppression reconciliation, provider quota automation, retention rules and end-to-end load testing before large rollout.


## Existing registered members: safe historical recovery (October 14, 2026)
- Retain ALL existing accounts, profile content and authentication. Never remove accounts from the product merely because they lack optional email consent.
- Deployed `legacy_recovery_overview` and `legacy_newsletter_status_filter` migrations. `public.legacy_user_recovery_overview()` is service-role-only and returns aggregate counts for 30/60/90-day activity proxies, confirmed addresses, membership, existing visit telemetry and recorded newsletter-consent evidence. No email addresses or content are returned; no emails are queued.
- Source-controlled dashboard `/super/email-operations.html` now includes **Existing-user recovery overview**, accessible through the protected `email-operations?legacyRecovery=1` endpoint.
- At inspection: 29 registered accounts, 16 email-confirmed accounts, and 13 verified accounts with last sign-in >30 days ago; 2 historical newsletter-signup records, **neither with a consent timestamp**. These are aggregate metrics. Last sign-in does not prove someone hasn't visited, especially while signed into a long-lived session.
- New newsletter form asks for an explicit newsletter opt-in, and the code writes consent_at for submissions made through that form; existing historical records do not get retroactive consent. `status=open` is the form's initial submission state and is not automatically a verified double opt-in. The dashboard reports recorded timestamp evidence as informational only.
- An account registration email address, a verified email, or a support contact does **not** automatically prove consent to win-back/promotional marketing. Do not blindly send a one-time permission-request campaign to everyone; applicable electronic marketing rules and the original signup wording need review.
- Existing inactive members who already have reliable, purpose-appropriate opt-in evidence can be considered for a narrowly scoped, unsubscribe-enabled campaign **after** legal/compliance review and operator authorization. At present none of the two historical newsletter records has a recorded consent timestamp.
- For dormant users without evidence of email permission, use opted-in channels they already follow (social updates, approved push notifications, previous newsletter subscribers whose permission is proven, community groups where sharing is appropriate), an upgraded public homepage, shareable posts, and a non-intrusive signup prompt for members who return. Do not upload unconsented account emails into Brevo marketing lists.
- Long-term inactivity reminders remain **opt-in only** and require a recorded post-opt-in website visit. They are designed for future visits, not retroactive mailing of all historical accounts.
- The new dashboard and test code remain in the development branch and need a Netlify build after credits return. Netlify delivery is still disabled.
