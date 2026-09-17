# Timzee Tech Hub — Master Audit Checklist

This is the canonical audit checklist for the September 17, 2026 hardening pass. It consolidates the requirements and defects reported across the latest review messages and separates source-verified facts from tests that still require a real browser session or a fresh deployment.

## 0. Release and source-of-truth controls

- [ ] Keep this branch reviewable before any production deployment.
- [ ] Treat `main`/GitHub source as the current code source of truth.
- [ ] Treat Netlify production separately: current production deploy is pinned to an older commit and is not the same as the latest GitHub commit.
- [ ] Reconcile historical markdown reports before treating statements such as “0 errors” or “complete” as current facts.
- [ ] Do not deploy until the browser regression suite below passes.

## 1. Authentication and OAuth

- [x] Supabase frontend uses a public publishable key, not a service-role key.
- [x] OAuth redirect construction is constrained to the site origin and preserves intended `next` navigation.
- [x] PKCE callback exchange is explicitly handled before normal auth reads.
- [ ] Verify Google login in a real browser from login page → provider → callback → authenticated home/profile.
- [ ] Verify the session survives a hard refresh after OAuth.
- [ ] Verify OAuth on mobile-sized viewport.
- [ ] Verify logout clears the session and protected UI disappears.
- [ ] Verify traditional email/password login and OAuth produce the same trusted user state.
- [ ] Verify expired/invalid callback codes fail gracefully instead of leaving a false “logged in” UI.
- [ ] Verify `next` redirects cannot escape the site origin.
- [ ] Remove or reconcile duplicated auth wrappers where they create divergent state (`auth.js`, `user-auth.js`, `supabase.js`).

## 2. Authorization and role security

- [x] Frontend trusted-role resolution now prefers `app_metadata.role`, then database-backed role sources.
- [ ] Remove remaining server-side authorization fallbacks that read `user_metadata.role` before trusted role sources.
- [ ] Audit every admin/moderator/super gate for trusted-role-only decisions.
- [ ] Verify role changes are reflected only after a token/session refresh where appropriate.
- [ ] Verify ordinary users cannot promote themselves through profile metadata, RPC, or direct API calls.
- [ ] Verify role-sensitive Netlify functions return 401/403 correctly for missing/normal users.
- [ ] Review SECURITY DEFINER functions and exposed RPC surfaces.
- [ ] Re-run Supabase security advisors after role/RPC changes.

## 3. Supabase data/API reliability

- [ ] Verify all frontend Supabase URLs/keys point to project `duvbcwwprkzzyzikmcol`.
- [ ] Verify each page reports actionable database errors instead of generic “invalid API key or database error”.
- [ ] Verify the Data API can access every intended public table/view.
- [ ] Verify every exposed table has RLS enabled.
- [ ] Verify UPDATE policies include both ownership `USING` and `WITH CHECK` where ownership can change.
- [ ] Verify SELECT policies exist where UPDATE/DELETE relies on reading rows first.
- [ ] Replace private `profiles.select('*')` reads with least-privilege column lists or a safe public profile view.
- [ ] Verify marketplace pages never require private profile fields merely to render public seller cards.
- [ ] Review all error swallowing (`catch { return [] }`) and add visible loading/error states to important data screens.

## 4. Marketplace — seller onboarding

- [x] Seller WhatsApp field exists in the current profile flow as `profiles.marketplace_whatsapp`.
- [x] Marketplace listing creation accepts multiple photo selections across repeated picker interactions.
- [x] Selected photos can be removed individually before publishing.
- [x] Photo count and file-size limits are enforced client-side.
- [ ] Normalize marketplace WhatsApp schema: current code uses `profiles.marketplace_whatsapp`, while an earlier migration also added `profiles.whatsapp_number` and `marketplace_items.seller_whatsapp`.
- [ ] Decide one canonical seller WhatsApp field and remove/retire redundant fields only after confirming no live data depends on them.
- [ ] Normalize and validate Nigerian/international WhatsApp numbers before saving.
- [ ] Verify seller contact information is not exposed to users who should not see it.
- [ ] Verify sellers can edit/update the WhatsApp number after onboarding.
- [ ] Verify listing creation rolls back cleanly if an image upload succeeds but the DB insert fails.
- [ ] Verify orphaned storage files are cleaned up after failed listing creation.

## 5. Marketplace — buyer contact and inquiry flow

- [ ] Replace the current `Contact Seller` alert/stub with a real connected action.
- [ ] The contact action must reveal/focus the inquiry UI or open the site's chat thread.
- [ ] Inquiry submission must create the marketplace inquiry row.
- [ ] Inquiry creation must create/connect the buyer ↔ seller chat thread.
- [ ] Seller must receive an in-app notification for the inquiry.
- [ ] When a seller WhatsApp number exists, provide an explicit WhatsApp contact action.
- [ ] Build WhatsApp deep links only from a normalized phone number and URL-encoded message text.
- [ ] WhatsApp message should identify the listing and make clear the buyer came from Timzee Tech Hub.
- [ ] Site chat should contain the listing context so the seller knows what the buyer is asking about.
- [ ] Buyer should see clear success/failure feedback after sending an inquiry.
- [ ] Prevent duplicate submissions from double-clicks or slow networks.
- [ ] Prevent sellers from sending buyer-style inquiries to themselves.
- [ ] Verify sold/unavailable listings disable or adjust contact actions appropriately.

## 6. Marketplace — images/gallery

- [x] Multi-photo selection exists in source.
- [ ] Verify selecting 2–8 images in one picker works.
- [ ] Verify selecting some photos, reopening picker, and adding more preserves the first selection.
- [ ] Verify duplicate file selections are ignored.
- [ ] Verify invalid file types are rejected with a useful message.
- [ ] Verify oversized files are rejected before upload.
- [ ] Verify the gallery renders safely when one image URL is invalid.
- [ ] Verify thumbnails work on mobile touch targets.
- [ ] Verify image loading does not block the main listing UI.
- [ ] Add lazy loading/appropriate dimensions to below-the-fold listing images.

## 7. Marketplace — listing data correctness

- [ ] Use least-privilege column selection instead of `select('*')` on listing/review reads where possible.
- [ ] Verify currency formatting uses the listing currency instead of hard-coded `$`.
- [ ] Verify prices render correctly for Nigerian/other supported currencies.
- [ ] Verify date formatting is locale-aware and consistent.
- [ ] Verify seller avatar/profile links use the correct seller id field consistently.
- [ ] Verify view counts cannot be spammed excessively by a single client.
- [ ] Verify similar listings query has an index-supported category path and a bounded result set.
- [ ] Verify expired listings are excluded where `expires_at` is applicable.
- [ ] Verify sold/unavailable listings are not surfaced as available recommendations.

## 8. Chat and messaging

- [ ] Verify chat list, thread open, send, receive, and refresh.
- [ ] Verify direct-message thread creation from marketplace does not create duplicate threads.
- [ ] Verify chat member checks cannot be bypassed with another member id.
- [ ] Verify message notifications link to the correct thread.
- [ ] Avoid selecting private profile columns unnecessarily in chat queries.
- [ ] Verify Realtime subscriptions unsubscribe on page change/unload.
- [ ] Verify duplicate listeners are not registered when navigating/re-rendering.

## 9. Theme and visual system

- [ ] Consolidate theme state to one canonical mechanism instead of multiple selector aliases unless there is a documented migration reason.
- [ ] Verify light mode has intentional contrast, spacing, surfaces, borders, and shadows.
- [ ] Verify dark mode has intentional contrast and does not look like an afterthought.
- [ ] Verify theme changes do not flash the wrong theme on initial load.
- [ ] Verify theme persists after refresh and across pages.
- [ ] Verify buttons, chips, inputs, cards, dialogs, and nav elements use a consistent radius scale.
- [ ] Reduce accidental use of `border-radius: 999px` on rectangular sidebar/navigation controls.
- [ ] Preserve true pill shapes only where the component semantics call for a chip, tag, toggle, or circular control.
- [ ] Ensure sidebar buttons look rectangular/modern rather than stretched ovals.
- [ ] Verify focus, hover, active, disabled, and keyboard-visible states in both themes.

## 10. Responsive/mobile behavior

- [ ] Test 320px, 360px, 390px, 414px, 768px and desktop widths.
- [ ] Verify header/nav never overflows horizontally.
- [ ] Verify sidebars collapse to a usable mobile flow instead of simply disappearing when their content remains important.
- [ ] Verify chat/discussion split-pane layouts behave correctly on narrow screens.
- [ ] Verify marketplace forms and image selectors are usable with touch.
- [ ] Verify buttons meet comfortable touch target sizing.
- [ ] Verify dialogs, dropdowns, and menus fit the viewport.
- [ ] Verify typography and cards do not cause horizontal scrolling.

## 11. Performance

- [ ] Investigate the current mobile Lighthouse baseline: Performance 72, Accessibility 89, Best Practices 92, SEO 100, PWA 30.
- [ ] Reduce render-blocking assets and duplicate stylesheet layers.
- [ ] Audit all page-level CSS imports for unnecessary global payload.
- [ ] Audit Google font loading and consider reducing font families/weights.
- [ ] Add explicit image dimensions and lazy loading where appropriate.
- [ ] Avoid repeated `select('*')` calls and unnecessary parallel queries.
- [ ] Debounce search/filter requests.
- [ ] Cancel stale fetches when the user navigates quickly.
- [ ] Avoid loading admin/moderator/curator code on ordinary public pages unless required.
- [ ] Verify cache-control for static assets.
- [ ] Re-test mobile performance after changes.

## 12. Dead code / duplicate code / old code fighting new code

- [ ] Search every exported function for actual call sites.
- [ ] Search every page for imported modules that are never used.
- [ ] Search every HTML page for scripts that are duplicated or obsolete.
- [ ] Identify duplicate auth helpers and decide which layer is canonical.
- [ ] Identify duplicate role-resolution helpers and unify behavior.
- [ ] Identify stale AI-key/browser-key code and remove it from docs and source where still referenced.
- [ ] Identify obsolete curator implementations and verify `Sync Now`, `Approve & Post`, source creation, and recommendation imports are real end-to-end actions.
- [ ] Audit all `alert()`/`prompt()` flows used as permanent UI instead of application toasts/dialogs.
- [ ] Search TODO/FIXME/“stub”/“coming soon”/“not implemented” strings and classify each one as intentional or defect.
- [ ] Identify duplicate CSS selectors and later-loaded overrides that silently fight earlier rules.
- [ ] Remove empty rulesets and dead selectors after confirming no dynamic dependency.
- [ ] Remove stale reports/documentation that claim fixes not present in the current tree, or clearly mark them as historical.

## 13. Routing/pages/disconnected UI

- [ ] Enumerate every HTML route in the repository.
- [ ] Verify every navigation link resolves to a real page.
- [ ] Detect duplicate pages that implement the same purpose under different filenames.
- [ ] Detect orphan pages not linked from the normal application shell.
- [ ] Detect JS modules that are never loaded by any reachable page.
- [ ] Detect UI controls whose event handlers only alert, do nothing, or point to placeholder destinations.
- [ ] Verify 404 behavior and internal links from 404 page.
- [ ] Verify deep links work when opened directly.
- [ ] Verify query-string routes (`listing.html?id=...`, thread/profile routes, etc.) handle missing/invalid ids.

## 14. Content and security hardening

- [ ] Review every `innerHTML` use for proper escaping and safe URL validation.
- [ ] Review every `href`/`src` built from database/user data.
- [ ] Verify report/inquiry text is length-limited server-side.
- [ ] Verify upload MIME type and extension validation cannot be bypassed by client-side checks alone.
- [ ] Verify storage policies match intended folders and ownership.
- [ ] Verify public buckets contain only intended public content.
- [ ] Verify no secret or service-role credentials exist in frontend source.
- [ ] Keep provider AI keys server-side only.

## 15. Netlify/serverless functions

- [ ] Audit every deployed function for authentication requirements.
- [ ] Audit every privileged function for trusted-role checks.
- [ ] Remove `user_metadata.role` from authorization decisions.
- [ ] Verify environment variables exist in production and are not client-exposed.
- [ ] Verify scheduled functions are protected from unauthorized manual execution.
- [ ] Verify function error responses are safe and do not leak secrets/internal stack traces.
- [ ] Verify function timeouts and external API calls are bounded.
- [ ] Verify RSS/GDELT failures do not block all other sources.
- [ ] Verify successful server writes are idempotent where cron/manual retries are possible.

## 16. Accessibility and usability

- [ ] Verify every meaningful image has useful alt text.
- [ ] Verify form controls have labels or accessible names.
- [ ] Verify keyboard navigation for menus, dialogs, galleries, and chat.
- [ ] Verify focus returns correctly after dialogs/menus close.
- [ ] Verify color contrast in both themes.
- [ ] Verify status is not conveyed by color alone.
- [ ] Verify loading/error/success states are announced or otherwise visible to assistive technology.

## 17. Verification gates before production

- [ ] Run static/source audit.
- [ ] Run Supabase schema/RLS verification queries.
- [ ] Run browser verification on public home.
- [ ] Run browser verification on login/OAuth.
- [ ] Run browser verification on marketplace listing/create/detail flows.
- [ ] Run browser verification on chat and discussion.
- [ ] Test light/dark theme.
- [ ] Test desktop + mobile widths.
- [ ] Check browser console for errors/warnings.
- [ ] Check failed network requests.
- [ ] Re-run Lighthouse/mobile audit.
- [ ] Verify the deployed commit exactly matches the reviewed Git commit.
- [ ] Only then resume automatic production deployment.

## 18. Current known findings from this pass

### Confirmed from source/database

- Google OAuth uses an explicit PKCE callback exchange in current GitHub `main`.
- Marketplace multi-photo selection code exists in current GitHub `main`.
- Marketplace seller WhatsApp onboarding exists and currently uses `profiles.marketplace_whatsapp`.
- `listing.html` still contains a `Contact Seller` alert/stub instead of a real contact flow.
- `profiles` currently has a public SELECT policy and includes a private `email` column, so `profiles.select('*')` is an overfetch risk.
- Current database contains multiple SECURITY DEFINER functions in the exposed `public` schema; several are directly executable by `anon`/`authenticated` and require continued review.
- Some current server/UI code still references `user_metadata.role` as a fallback.
- Current production Netlify deployment is pinned to commit `0b6270fed7b527a30849a07debd9f04004536edf`, while GitHub `main` has newer commits.

### Requires a real browser/deployment test

- Whether Google OAuth now visibly leaves the user logged in after a real provider callback.
- Whether multiple image selection behaves correctly in a real browser.
- Whether the new light/dark theme is visually balanced across all pages.
- Whether sidebar controls still look too pill-shaped at actual breakpoints.
- Whether Supabase reads succeed end-to-end on the current reviewed build.
- Whether marketplace inquiry → chat → WhatsApp works end-to-end.
- Whether console/network errors remain after all hardening changes.
