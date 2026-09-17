# Timzee Tech Hub — Audit Results — 2026-09-17

## Audit scope

Reviewed the current GitHub `main` source, recent commit history, Netlify project/deployment metadata, current Supabase schema/RLS/function privileges, and the latest reported UX requirements.

## Verified fixes already present in GitHub main

- Google OAuth uses an explicit PKCE callback exchange before normal auth reads.
- The frontend uses the current Supabase publishable key.
- Marketplace seller onboarding includes a required WhatsApp number using `profiles.marketplace_whatsapp`.
- Marketplace listing photo selection supports multiple images across repeated picker interactions, with deduplication/removal and client-side count/size limits.
- Trusted role resolution was moved toward `app_metadata`/database-backed roles instead of trusting editable user metadata in the main auth layer.
- Provider AI secrets were moved out of browser storage and the LLM proxy uses server-side provider keys.

## New database hardening applied during this audit

The following direct RPC privileges were tightened in Supabase project `duvbcwwprkzzyzikmcol`:

- `grant_role(uuid,text)`: PUBLIC execute revoked; authenticated retained.
- `revoke_role(uuid,text)`: PUBLIC execute revoked; authenticated retained.
- `set_author(uuid,boolean)`: PUBLIC execute revoked; authenticated retained.
- `increment_profile_points(uuid,integer)`: PUBLIC execute revoked; authenticated retained.
- `handle_marketplace_inquiry_notification()`: PUBLIC execute revoked because it is a trigger function, not a client RPC.

A post-change privilege query confirmed the four client-facing functions are no longer executable by `anon`/PUBLIC and remain executable by `authenticated`; the marketplace inquiry notification trigger function is no longer executable by either client role.

## Confirmed defects / blockers

### P0 — Marketplace contact button is disconnected

`listing.html` still handles `Contact Seller` by showing an alert rather than opening the existing inquiry form, creating a real chat thread, or exposing the seller's WhatsApp contact action.

The page already has an inquiry form and imports `createMarketplaceInquiry`, so this is a wiring/integration defect, not a missing backend primitive.

### P0 — Server authorization still contains unsafe user-metadata fallbacks

Searches still find `user.user_metadata?.role` in serverless functions such as `scout-news.js`, `list-admins.js`, `list-users.js`, and `create-admin.js`. Supabase authorization guidance says editable user metadata must not be used for authorization. These functions need consistent trusted-role resolution.

### P1 — Public profiles policy plus `select('*')` is too broad

The `profiles` table currently has a public SELECT policy and contains private-capable fields including `email`. Multiple client modules use `profiles.select('*')`. Public profile rendering needs a least-privilege column set or safe public view rather than exposing all profile columns through normal reads.

### P1 — Marketplace seller identity fields are inconsistent

Current marketplace code/schema uses `marketplace_items.user_id` as ownership, while some listing logic refers to `seller_id`. The current schema also contains redundant WhatsApp-capable columns created by earlier work: `profiles.marketplace_whatsapp`, `profiles.whatsapp_number`, and `marketplace_items.seller_whatsapp`.

A single canonical ownership and seller-contact model should be selected before further marketplace features are added.

### P1 — Hard-coded marketplace currency display

`listing.html` renders prices using `$` rather than the listing's `currency` field. This is inconsistent for a Nigerian marketplace and should be corrected throughout marketplace presentation and inquiry context.

### P1 — Current Netlify production is not the reviewed GitHub main

Netlify production is currently pinned to commit `0b6270fed7b527a30849bd...`, while GitHub main is newer. Production therefore cannot be treated as visual/runtime proof for the latest source.

## Visual/UI findings

Source inspection confirms multiple full-pill radius rules (`border-radius: 999px`) across navbar, filters, profile tabs, buttons, etc. Some are appropriate chips/search controls/avatars, but the radius system is broad enough to create the user's reported over-rounded/oval feeling.

The theme system also supports multiple dark-theme selector aliases (`data-theme`, `.dark-mode`, `.theme-dark`) across CSS layers, indicating legacy theme state overlap that should be consolidated carefully.

A true click-through browser verification was not possible in this environment because BrowserAct/agent-browser could not be installed: network/DNS resolution prevented package installation, and no browser automation CLI was present. The Netlify connector was still used to inspect the actual deployment metadata and its recorded Lighthouse scores.

## Performance baseline

The current Netlify production deploy metadata reports mobile Lighthouse:

- Performance: 72
- Accessibility: 89
- Best Practices: 92
- SEO: 100
- PWA: 30

These should be treated as a baseline, not as the score of the current GitHub main branch.

## Master checklist

See `AUDIT_MASTER_CHECKLIST.md` in this same branch. It is the canonical release checklist covering authentication/OAuth, Supabase/RLS/storage, marketplace, chat, UI/theme, responsive behavior, performance, dead code, duplicate code, routing, accessibility, Netlify functions, and final browser/deployment gates.

## Release recommendation

Keep Netlify deployment paused. The highest-value remaining work is to wire marketplace contact → inquiry → site chat → WhatsApp, remove unsafe server-side `user_metadata.role` authorization fallbacks, fix the public-profile overfetch model, normalize marketplace identity/contact fields, and then run a real browser regression pass against a deployed preview before production is resumed.
