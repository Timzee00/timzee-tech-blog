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
