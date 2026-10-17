# Site-wide viewport & database hardening — October 17, 2026

This pass targets source-level release risks. It does **not** certify that the paused Netlify production deployment or authenticated mobile user journeys have passed end-to-end checks.

## Findings and fixes

| Issue | Finding | Remediation |
| --- | --- | --- |
| Site-wide horizontal overflow | `responsive.css` and the later `design-system.css` both overrode the base viewport safeguards | Contain root overflow and load `viewport-guard.css` **after** design-system and mobile overrides in public and staff bundles |
| Missing local scroll surfaces | Some rich text, preformatted code, long tables, and dialogs could escape a narrow viewport | Add bounded code/table scrollers, flex/grid minimum-width limits, responsive dialog and form constraints; preserve horizontal scrolling in deliberate tab strips |
| Duplicate migration versions | Four pairs of `supabase/migrations/*.sql` files shared the same 14-digit version | Replaced each duplicate with a **content-identical**, uniquely versioned file; require `validate-migration-versions.mjs` before every build |
| Untrusted settings JSON | Existing preference merge allowed inherited keys and wrong types; database had no JSON size bound | Whitelist known keys/types/options, disallow inherited keys, and apply a database CHECK for object JSON <= 64 KiB |
| Local cache clearing | The Clear local preferences control wrote defaults back into storage instead of removing cached values | Actually delete only the preference cache keys; never delete auth credentials or replace remote preferences |
| Public execution of internal functions | Internal PostgreSQL `SECURITY DEFINER` trigger functions still had direct EXECUTE grants for browser roles | Revoke PUBLIC/anon/authenticated EXECUTE on trigger functions and internal automod scoring helper; leave intentional app RPC grants untouched |
| Missing future link-integrity gate | Source HTML could add broken local route/image/script/css references unnoticed | Add `validate-page-links.mjs` to audit every public and staff HTML document pre-build |

## Verified database facts

The live project's read-only integrity review found:

- Zero incorrect community member counts.
- Zero incorrect forum reply counts.
- Zero incorrect thread vote scores.
- Zero replies without a thread.
- Zero cross-thread reply references.
- Zero duplicate community memberships.
- Zero public-schema `SECURITY DEFINER` functions directly executable by PUBLIC after hardening.
- Zero of the 38 internal security-definer trigger functions directly executable by either anon or authenticated after hardening.
- Existing user settings had a maximum serialized size of **781 bytes**, well below the new 65,536-byte constraint.
- Profile records are owner/staff protected by RLS. Public directory records are maintained separately, and no current opted-out public profile record had an exposed email in the database snapshot.

These are integrity queries and privilege checks, not a full penetration test or user-session test.

## Static page review

Checked all **44** source HTML pages, including public/admin/moderator/author/super routes:

- Every page had viewport metadata and a title.
- **593** local linked routes/static resources resolved to files in the branch.
- Source integrity is now rechecked automatically during the build.

The additional browser viewport regression suite covers major pages at 320px, 390px, and 768px, and tests local scrolling for extremely long code blocks.

## Acceptance commands after restoring build access

```bash
npm ci
npm run check
npm run build
npm run test:browser
```

Browser acceptance must include both anonymous and authenticated accounts, chat and forum dialogs, profile/settings toggles, table-heavy staff panels, gallery/video players, Android virtual keyboard, device rotation and 320px width, dark mode, accessibility, and authenticated database permission tests.

**Current blocker:** both the Netlify preview and production website were inaccessible to the browser inspector (`ERR_TUNNEL_CONNECTION_FAILED`). Browser/UI assertions and the full Node build have not been claimed as successfully executed in this pass.

## Deployment and rollback

1. Keep this release in pull request #7 until CI and mobile acceptance pass.
2. Apply forward-only SQL migrations in order. Do **not** replay existing migrations against the already-migrated live database.
3. Check Supabase policy grants and triggers using a service-authenticated audit, and verify normal user insert/reply flows after removing direct EXECUTE on internal functions.
4. If CSS causes a visual regression, revert the last import-layer change in Git without rolling back user data or unrelated Supabase migrations.
5. Never delete legacy forum messages or overwrite their archived source records.
