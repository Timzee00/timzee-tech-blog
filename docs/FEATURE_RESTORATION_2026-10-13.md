# Feature restoration and integration audit — 13 October 2026

**Scope:** Timzee Tech Hub PR #4, based on Codex PR #3. All source commits are on draft branch `fix/sitewide-shell-20261010`; production and live Supabase were NOT changed. The latest available Netlify deploy preview had commit `403d628e` from Oct 12, older than these repairs, and was locked. Its shared Supabase backend makes destructive tests unsafe.

## Confirmed live problems

- Production database has **8 enabled curator RSS sources and 0 imported curator articles**. All 8 have `last_fetched_at IS NULL`; the only curator settings row reports `scout_last_status='failed'`, last run Oct 12. This corroborates the persistent failure, not proof of the exact runtime cause.
- Netlify scheduled functions cannot be HTTP-called through their scheduled function URL, and their schedule only executes on published production deploys. A new authenticated HTTP `scout-news-manual` endpoint drives the admin **Sync Now** action. The separate `scout-news` hourly function remains scheduled.
- The scheduler's legacy code recognized only a Netlify header; it now also recognizes Netlify's documented JSON `next_run` event payload. The manual HTTP gateway strips BOTH scheduling headers and payload before forwarding, preserving Super Admin-only access. A scheduled `Run now` test and Netlify logs are required to validate the actual runtime.
- The scout now checks at most 4 oldest sources and 6 draft items per source/run, uses bounded external timeouts, respects unique URL constraints rather than a SELECT-before-INSERT race, emits `failed/partial/success/no_new_articles`, writes `system_job_status` and the existing curator settings last status. A complete all-source failure returns non-2xx instead of success. Importing external content does NOT publish it automatically; editorial review stays required.
- Live `consume_ai_rate_limit` RPC exists; AI failures can still arise from env scopes/missing Functions keys, provider-specific model mismatch, provider access/billing or an older Netlify deploy. Server function now supports **authenticated GET booleans** about configured provider keys and client resolves provider-valid models; never sends API keys to clients.

## User-facing features added/repaired

- `videos.html` and immersive `video.html` now have For You and Following modes via the existing `get_personalized_feed` / `get_following_feed` Postgres ranking functions; videos grid also has Latest. Candidate reads are bounded to top 50, ranked by server and hydrated from public videos with a per-viewer 45-second cache. Video searches/categories are explicitly Latest and do not masquerade as personalized.
- `profile.html` gets a portrait Videos tab, public video gallery, 24-row load more, editable self-upload CTA, creator-style header and compact stat design. Profiles now offer **Follow creator / Following** using actual Supabase follows, driving the Following recommendation source rather than fake UI.
- Mobile bottom navigation now includes Home, For You, Reels, Market, Chat, Profile/Login. Shared footer adds discoverability links. Dropdowns and mobile drawers are constrained to the viewport/safe areas and scroll inside their own panels.
- The settings page adds actual Supabase password change, global sign-out, account preferences JSON export, and existing reset password/sign out; reduces motion and increases contrast site-wide through persisted preferences. Video autoplay, mute default and data saver affect the reel player. Cookie settings load the consent implementation on demand.
- User-stored recommendations, account settings and frontend preferences are still subject to Supabase permissions and cross-account/regression tests. Do not claim every legacy setting is yet implemented across every feature module.

## Brevo is not configured automatically

- Supabase Auth confirmation/reset/magic-link email requires custom SMTP configured at the Supabase Dashboard and verified Brevo SMTP credentials; the Netlify `BREVO_API_KEY` alone does nothing for Supabase Auth SMTP.
- Follow `docs/BREVO_SUPABASE_SETUP.md` with Brevo verified sender and SPF/DKIM, SMTP relay `smtp-relay.brevo.com`, port 587, exactly the SMTP Login shown by Brevo, generated **SMTP key** (not REST API key), auth URL allowlist and a synthetic/test account for signup and recovery.
- Connected Supabase tooling has no write operation for Auth custom SMTP and connected Netlify tooling has no site-level env editor. A human account administrator must enter the sensitive values in each service's secure dashboard and initiate a new deploy to apply Netlify Function keys. Do not paste credentials into this chat.

## Test and release gates

- Focused JavaScript logic checks passed for video candidate order, deduplication and per-user cache separation; a source parse check passed for Groq/model resolution. New browser regressions cover FYP feedback, video modes and mobile menu boundaries but full Playwright/browser suite is **NOT yet executed**.
- Required: staging Supabase isolation; build exact SHA `npm ci && npm run build && npm test && npm run test:browser`; 2 distinct logged-in users; real message/media/auth/recovery; Netlify Functions `Run now` Scout and manual Super Admin Scout; Brevo test mail; AI provider Test Connection; mobile screenshots in both themes.
- Production promotion remains blocked on explicit release approval, proper staging backend, secure configured env, CI/budget authorization and measured load readiness. Do not treat these source commits as proof of a working live deployment or a 100k-user capacity certificate.

## Feature comparison

| User request | Implemented in draft branch | Live verification |
|---|---|---|
| Scout imports | Repaired scheduling detection, manual auth gateway, bounded imports, honest monitoring | Still failed historically; new code not deployed/tested |
| AI connection | Provider-compatible model and authenticated key-present diagnostic | Credential scopes/provider request not yet verified |
| Brevo/Supabase | Exact SMTP integration instructions and readiness checks | Dashboard credentials/settings not accessible; unconfigured here |
| Video feeds | For You, Following, Latest, preference controls, real profile follows | Browser tests pending |
| Creator profile | Portrait uploads gallery, follows, profile stats and actions | Browser/E2E pending |
| Settings | Password, sessions, accessibility, media preferences, opt-outs and export | Cross-feature settings audit incomplete |
| Menus/footer | Responsive viewport bounds, new navigation tabs and footer | Physical mobile screenshots pending |

## Safe administration checklist

1. Netlify deploy-preview settings must map to a separate staging Supabase project. Approve any paid build/deployment usage before scheduling.
2. Netlify Site Configuration → Environment Variables: check precise `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`/`OPENAI_API_KEY`/`ANTHROPIC_API_KEY`, scope Functions and targeted deploy context. Do not expose service-role in client bundles.
3. Supabase → Authentication → Emails → SMTP Settings: configure Brevo; test real delivery and valid redirect URLs.
4. Netlify → Functions → scheduled `scout-news`: Run now (published functions actually schedule; preview functions require manual test). Inspect source-level error output and saved `system_job_status` after deployment.
5. Under a synthetic Super Admin, test curator Sync Now; under an ordinary member, assert 403 forbidden. Do not depend on scheduling headers in public HTTP calls.
6. Exercise all user-facing controls under anonymous, user and staff roles in a new staging deployment and record failures explicitly.

Official guidance: https://docs.netlify.com/build/functions/scheduled-functions/ ; https://developers.brevo.com/docs/supabase-smtp-integration ; https://supabase.com/docs/guides/auth/auth-smtp .
