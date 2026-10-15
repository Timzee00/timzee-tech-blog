# Brevo + Supabase Auth mail integration — 13 October 2026

## What delivers which emails

- **Supabase Auth custom SMTP** sends confirmation, invitations, magic links and password reset emails. This SMTP setting is managed in the **Supabase Dashboard**, not Netlify. A `BREVO_API_KEY` in Netlify will NOT configure Supabase Auth SMTP.
- **Brevo Transactional API** is a separate server-side integration for product mail (receipts, marketplace updates, newsletters). Use dedicated templates, user opt-in preferences, retries and a durable queue; never expose a Brevo API or SMTP key in public JavaScript, or allow browsers to pick arbitrary recipients.

## Configure in Supabase

1. In Brevo, verify the sender domain and configure **SPF/DKIM** DNS, then verify the exact sender address intended for mail, such as `no-reply@your-domain.example`.
2. Brevo Settings → SMTP & API → SMTP: copy the **SMTP Login** and generate an **SMTP key** (not the REST API key). The login may be an account email or a generated `...@smtp-brevo.com` address; use the value Brevo shows.
3. Supabase project `duvbcwwprkzzyzikmcol` → Authentication → Emails → SMTP Settings → **Enable custom SMTP**.
4. Sender name: `Timzee Tech Hub`; sender email: the exact verified address. Host: `smtp-relay.brevo.com`. Port: `587` with STARTTLS, or `465` SSL/TLS. Username: the Brevo SMTP Login. Password: the Brevo SMTP key. Save settings.
5. Supabase Auth → URL Configuration: set the production `Site URL` and allowlist the production auth callback URL. Preview URL(s) should be allowlisted for isolated staging tests only. Never place secrets in redirects.
6. Adjust **Authentication → Rate Limits** after testing and within your Brevo sending quota. Supabase custom SMTP initially raises its test-only threshold but does not make email unlimited.
7. Verify with a TEST account: signup confirmation, reset password, recovery redirect, and resend. Inspect Brevo Transactional email logs for delivery/deferred/bounce details and Supabase Auth logs for rejection/rate limiting. Do not test on real customers.

## Netlify serverless AI credentials

- `GROQ_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` are distinct provider keys for the Netlify `llm-proxy`; only the key for the selected provider needs to exist. `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are also needed for authenticated proxy access.
- Ensure the key is scoped to **Functions**, applies to the correct deploy context, and then redeploy. Netlify variables become available at function runtime based on the deployed version; changing the dashboard value alone does not update an older published deployment.
- The AI Settings page now runs an **authenticated GET diagnostic** on `llm-proxy` to show provider-level configured/not configured flags, never secret values. A green credential result does not prove provider billing, model access or network connectivity; use **Test Connection**.

## Rollout and incident handling

- Neither Netlify connector available in this workspace nor Supabase connector currently exposes Auth SMTP configuration or site-level Netlify environment variables for editing. These settings must be entered in each service's secure dashboard by an authorized project admin; do not send SMTP credentials or API keys into this chat.
- After configuration, capture evidence that a test recipient received both auth confirmation and reset; verify authenticated AI call and job status on the SHA actually deployed.
- Never roll out a custom SMTP sender or global newsletter to 100k users without verified SPF/DKIM, unsubscribe processing, bounce handling, rate limits, data-consent review and queue backpressure.

References: https://developers.brevo.com/docs/supabase-smtp-integration , https://supabase.com/docs/guides/auth/auth-smtp , https://developers.brevo.com/docs/smtp-integration .
