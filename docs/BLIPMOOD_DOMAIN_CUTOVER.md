# Blipmood domain cutover — checked against production source (2026-10-26)

## Scope / important safety rule

The **displayed product name** is **Blipmood**; the legal parent may remain
**Timzee Corp**. The current live host is
`https://timzee-tech-blog.netlify.app` and the actual database project
is `duvbcwwprkzzyzikmcol`. Do **not** rename/recreate the database project,
delete the existing Supabase project, replace account IDs, change sender
addresses without verification, or simply swap every old-URL literal.
Wait until a real chosen Blipmood host is live, verified, and HTTPS-enabled.

## Phase A — reserve the destination, keep the old hostname working

1. Register/verify the chosen Blipmood domain, including trademark/handle
   clearance. This file does **not** assume `blipmood.com` is owned.
2. On Netlify: add the new domain to the **existing**
   `timzee-tech-blog` project and validate its ownership/TLS certificate.
   Set the primary domain only after HTTPS and health checks pass.
   If using a new Netlify subdomain, verify that slug is available before
   renaming the existing site. Keep the former hostname accessible.
3. In Supabase Auth (project `duvbcwwprkzzyzikmcol`): set Site URL to the
   new verified site, and add explicit Redirect URL entries for
   `https://NEW_HOST/login.html` (including the supported `next` query
   variant if necessary). Retain the old allowed origin for existing links
   during transition. The client uses `assets/js/auth-redirects.mjs`.
4. Check Google OAuth and Microsoft/Azure OAuth provider settings. The
   **provider callback** commonly remains at
   `https://duvbcwwprkzzyzikmcol.supabase.co/auth/v1/callback`;
   do **not** replace it with a fabricated /auth callback on the new site.
   If the provider config requires permitted origins or app homepages,
   add the new origin and verify the redirect chain in a fresh browser.
5. Complete Brevo sender domain verification, SPF/DKIM/DMARC for a new
   `@NEW_HOST` sender, and set Netlify `BREVO_SENDER_EMAIL` /
   `BREVO_REPLY_TO_EMAIL` only after a provider-verified test. Display
   sender name is Blipmood; do not use a nonexistent sender mailbox.

## Phase B — source-controlled production origins and links

After confirming NEW_HOST, change and test **all** of the following:
- `assets/js/supabase.js` — `SITE_URL` fallback for OAuth/signup/reset.
  Dynamic login redirects use current trusted origin.
- `index.html`, `post.html`, `login.html`, `profile.html` and other
  public HTML SEO `canonical`, `og:url`, `og:image` and Twitter cards.
- `netlify/functions/sitemap.js` and `sitemap.xml` static fallback —
  generated loc URLs must share the new canonical origin.
- `robots.txt` — new sitemap address.
- `netlify/functions/email-worker.js` — unsubscribe/preferences links
  and embedded branded image origin.
- `netlify/functions/_lib/staff-email-template.js` — embedded logo origin.
- `scripts/validate-production-config.mjs` and release tests/checks
  that assert a literal origin.
- Audit any runtime content, scheduled jobs, SQL function template links,
  Netlify environment variable values and integration hooks for old URL.
  Example command: `git grep -n 'timzee-tech-blog.netlify.app'`.
- Retain old host forwarding/redirects and don't break previously sent
  unsubscribe emails, password reset links, or deeplinks while active.

## Phase C — third-party, indexing and device delivery

- **Supabase**: Auth URL/redirect allowlist, email confirmation and reset
  templates, Google/Azure OAuth provider config.
- **Netlify**: primary/custom host, HTTPS, redirect plan, site-specific
  environment variables and deploy automation. Publish a Git production
  deploy: the live site previously pointed to an older Netlify Drop deploy.
- **Brevo**: verified sender email domain + SPF/DKIM/DMARC, unsubscribe
  landing pages, contact list forms, email templates/campaign links. Keep
  unsubscribes from old sent emails functional.
- **Web push/PWA**: subscriptions and service-worker registrations belong to
  the **origin**; users may need to opt in again on the new host. Reconfirm
  VAPID configuration, push worker routes, notification click URLs and
  background behavior; don't silently copy browser subscriptions.
- **Search/social**: Google Search Console add and verify new property,
  submit new sitemap, check canonical URLs, OpenGraph image fetching, and
  implement old-to-new 301 redirects once the new host works.
- **GitHub**: repository description/Homepage URL and any documented
  site/preview URLs, but **do not** rename the GitHub repo unnecessarily.
- **Other connected apps/services**: any callback/webhook endpoints, RSS or
  syndicated feeds, social media bios, marketplace/share links, analytics,
  affiliate integrations or external app links that use the old origin.

## Required release acceptance

Test on the old and new domains: home, signup, login, Google/Microsoft OAuth,
email confirmation, reset password, profile, posting/attachments, comments
and mentions, communities and replies, notifications (in-tab and push),
email opt-out, marketplace, download/feed tools, sitemap, 404, light/dark
theme, desktop and Android phone. Switch canonical/primary URL only after
the new domain passes. Keep an easy rollback path.
