# Site-wide design consistency and review gate — 2026-10-11

**Status:** Source changes committed in draft PR #4. The branch is **not yet deployed or browser-tested** as a full release. It builds on draft PR #3 rather than replacing Codex's editorial redesign.

## Unified visual language

- Product identity: Timzee Tech Hub, with optional admin-configurable site name; `Powered by Timzee Corp` remains in the shared footer.
- Light mode: warm off-white background, white raised surfaces, dark ink and teal primary accent. Dark mode: navy background, navy raised surfaces, light text and mint accent.
- Tokens: `assets/css/variables.css` is the source for colors, font stacks, spacing, corner radius and focus colors; `design-system.css` finishes public components; `admin.css` maps staff tools onto the same semantic palette.
- Typeface: shared `--font-body` for controls and prose, `--font-display` for headings. 16px inputs/body scale on mobile to avoid accidental browser zoom; labels and status messages must remain legible.
- Component language: bordered surfaces rather than heavy shadows; 9px action buttons and inputs, 14–16px cards, full pills only for status/tags. Danger actions remain visually and semantically distinct.
- H1 hierarchy: home hero is distinct; Stories, Communities and Profile now have a meaningful primary heading. Plain page titles receive the same size/spacing through the global CSS component. Dynamic branding must reach header, footer and page title.
- Navigation: desktop header and dropdown, mobile drawer and bottom tabs share a route-normalized active state. Settings and For You links inserted by the shell use the same current page logic.
- Feedback: one consent card (in normal flow below sticky header on viewports <=960px), one app-toast system, inline form errors, native accessible modal where used. Cookie notice must not cover login, chat composer or bottom tabs.
- Staff pages: author, moderator, admin, super administration and standalone staff login preserve their specialized layouts and permission checks, but adopt the same colors, typography, focus treatment and card/button shape language as public pages.

## Regression evidence added

- `tests/design-consistency.test.cjs`: public pages import the canonical entry stylesheet; admin/public shared token sources; semantic page headings.
- `tests/browser/sitewide-shell.spec.cjs`: per-route typography/color parity, staff surface styling, mobile cookie placement, single H1, footer branding, active Settings/For You links.
- Existing `tests/browser/experience.spec.cjs` sweeps page routes, local asset loading, horizontal overflow and selected axe accessibility checks.

## Manual visual acceptance to complete

Run the exact future preview branch build on independent staging with synthetic user accounts. Capture screenshots for **320, 390, 768, 1024, 1440px widths**, each in light/dark mode:
- Home, login/signup/recovery, posts, community, chat, stories, videos, marketplace, novels, AI assistant, profile, settings, policy/help routes.
- Authenticated and anonymous states, permission denied, empty/loading/error/populated states.
- Admin, moderator, author, super-admin navigation, modals, dense tables and forms.
- Check keyboard focus, 200% browser zoom, OS reduced-motion, controls without horizontal clipping, readable overlay stacking, cookie preferences, screen reader accessible names and status feedback.
- Verify media fallback for failed remote images and compare component geometry and colors across page captures. Address any inconsistent legacy inline styles after inspecting actual screenshots.

**Do not advertise production completeness yet:** the current public preview is older, still indexes publicly, and shares the live Supabase backend. Full build, the browser suite, authorized multi-account tests, security checks and release matching remain pending. Release and sale-readiness criteria remain in `docs/BUYER_READINESS_GATE.md`.


## October 12 continuation — functionality and accessibility

This continuation addresses issues identified in source review, **not** a fresh deployment:

- **Stories:** replaced the handlerless guest-visible "Create status" widget with a single static, styled button that appears only for authenticated users. The avatar tile itself is a native button; both controls open the same composer without custom keyboard handlers. CSS lives in the shared stylesheet rather than runtime-injected styles.
- **Story author safety and ordering:** author tiles are assembled via DOM APIs with `textContent` for names and `img.src` property assignment rather than unescaped `innerHTML`. Tiles follow the same order as the groups in state and the viewer; the old repeated `insertAdjacentElement("afterend")` reversed the order.
- **Story viewer/composer:** dialog roles, labels, Escape handling, keyboard focus cycle, return focus to opener, and basic background scroll handling. Object URLs for local Story previews are revoked when replaced or closed; a successful post followed by a feed-refresh failure is communicated without claiming posting failed.
- **AI Chat and Reels:** the two public routes without a first-level heading now have a visually hidden `h1`; the fullscreen reel now has a main landmark and skip link. Untrusted video thumbnail/video URLs are HTML-attribute escaped in the reel template, and its action buttons have accessible names.
- **Regression coverage:** Playwright checks were added for Story creation by guests and members, Story display order, malicious profile name/URL handling, modal focus, and AI/Reels headings. The Node source tests also require exactly one public `h1`, a skip link to main, and safe video attribute rendering.

### Verification limits

The changed JavaScript modules and several inline page scripts were parsed in a sandboxed JavaScript syntax check and produced no syntax errors. This **is not a replacement** for `npm run build`, the whole Node test suite, Playwright, live Supabase RLS/Storage tests, or a new Netlify preview. All changes remain in draft PR #4, targeting Codex's existing PR #3; nothing was deployed or migrated.

The next required action for release acceptance is a clean Node 22 `npm ci && npm run build && npm test && npm run test:browser` on an isolated staging setup, followed by evidence-based fixes for whatever fails. GitHub Actions billing and Netlify build-budget constraints remain important release blockers until verified resolved.


## October 12 evening: functional UX and regression gate

The shared footer formerly replaced *every* legacy footer with only generic community links, silently removing page-specific destinations (for example, `listing.html`: "Back to Marketplace" and "Report Problem"). `ensureSiteFooter` now collects safe, same-origin contextual links before replacing the old markup and preserves them in a visually consistent `Page actions` navigation section. Calling it again is idempotent: no duplicate branding or controls. The Cookie Settings button awaits the lazy preferences module and displays an actionable inline error if loading fails, rather than doing nothing.

The Story viewer previously started video progress only after `loadedmetadata`, with no `error` or stalled-media path. A missing video or delayed metadata response could leave the viewer stuck indefinitely. The viewer now provides native playback controls (including manual playback and unmute), starts progress when playback begins, clamps finite durations, times out initial metadata loading, and displays a recoverable error with automatic advancement when media is unavailable. Repeated progress timers are cleared. The Story stylesheet and bundled stylesheet remain canonical.

New Playwright regressions cover footer contextual actions, footer idempotency, Cookie Settings, and failed Story video playback. The in-repository browser runner has **not been run** for these changes. A read-only source inspection confirmed the code paths and inline Story script parsed successfully. No release has been built from PR #4; GitHub had no workflow runs for the latest commit, and production and Supabase data remain unchanged.

The next non-negotiable acceptance step is a controlled, isolated staging build and full automated/browser tests (including mobile and both themes), followed by fixing observed failures rather than treating source-only evidence as release certification.
