# Timzee safe rebrand rollout (no breaking changes)

## Branch isolation
- Source branch: `brand/timzee-transition-20261020`, forked from `main`.
- Existing feature PR #7 is open and contains a large number of changes.
  Resolve/merge it separately before rebasing or combining the rebrand.
- No automatic push to `main` or production deployment from this branch.
- Current Netlify domain `https://timzee-tech-blog.netlify.app` remains authoritative until new domain ownership, certificate, DNS and callbacks are tested.

## Phase 0 — Brand clearance, owner approval
Verify legal searches, domains, handles, company operator, existing registrations
and necessary notices. Record the go/no-go decision and owners.

## Phase 1 — Safe, reversible UI rename
Centralize new display names in a shared brand configuration. Then update in batches:
global nav, home title, footer, legal template headers (not legal party or binding
contracts), article bylines, verified badge alt labels, social preview metadata,
OpenGraph, error and auth screens, onboarding, emails and notifications.
The old name should remain a recognized alias and searchable keyword in copy
during the transition.

## Phase 2 — Routing and identity (NO early changes)
- Preserve all existing HTML paths, post IDs, slugs, user IDs, OAuth account IDs,
  cookies, storage keys, SQL migrations, Supabase project IDs and RPC names.
- Preserve `/chat.html`, `/discussion.html`, `/profile.html`, all old
  `?id=` deep links, old Netlify domain, and `/.netlify/functions/*`.
- Keep existing OAuth/auth redirect allowlists until new domain callbacks work.
  Validate Google/Microsoft sign-in, PKCE, reset-password and email magic links.
- New custom domain, if purchased, should first point to *same app and DB*.
  Verify TLS, cookies, canonical redirects, sitemap, robots, and social cards.
- Only after a verified new domain, change canonical URLs and sitemap in a
  *separate* deployment and add tested permanent 301 redirects on the old host.
- Keep legacy domain active for at least 12 months; longer if it has backlinks.
- Never run a SQL table rename merely to rebrand a label.

## Phase 3 — Communications
Publish brand history/FAQ, gentle 60–90 day banner, status post and verified
social notices; use consent-compliant email only. Keep the same account credentials,
privacy terms and moderation rules unless separately revised and notified.

## Verification checklist
- Anonymous: 320px, 390px, 768px, desktop; light/dark; keyboard focus.
- Two signed-in accounts: login, logout, OAuth callback, password recovery,
  notifications, post reading/writing, DMs, groups, verified badges.
- Public share: each canonical URL, OG image, sitemap.xml and 404 behavior.
- Payments, webhooks, Stripe/provider return URLs only if configured; never
  overwrite an active third-party callback without testing.
- DB migrations are unchanged. No destructive SQL for a display-name release.
- CDN and browser cache invalidation and accessible logo fallback tested.
- Rollback: revert UI branding PR and metadata; keep old domain and OAuth
  redirects working, and do **not** revert account databases.

## Things explicitly NOT to do during rebrand
- Rename GitHub repository or Netlify site before confirming all integrations.
- Bulk-replace `timzee` inside code, localStorage keys, function names, SQL,
  RLS policies, migration filenames or webhook signatures.
- Swap active domains in Supabase Auth site URL, email worker, payment provider,
  server-side absolute URLs, sitemap or OG metadata before a verified domain.
- Claim the brand is trademark cleared or that preferred usernames are available.
