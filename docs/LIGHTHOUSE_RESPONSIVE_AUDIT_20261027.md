# Blipmood responsive QA and Lighthouse — 2026-10-27

## Scope
The public origin `https://blipmood.netlify.app/` still serves a locked
2026-10-25 publish (`a1caa169`). The tested source is GitHub `main`,
before promotion. Metrics below are separated by environment and are not an
apples-to-apples before/after production score comparison.

## Lighthouse (Chrome 1243 / Lighthouse 13.5.0, simulated mobile and desktop)

| Audit | Published mobile (old code) | Updated build mobile (local) | Updated build desktop (local) |
| --- | ---: | ---: | ---: |
| Performance | 77 | 59 | 92 |
| Accessibility | 100 | 100 | 100 |
| Best practices | 96 | 96 | 96 |
| SEO | 100 | 100 | 100 |
| Cumulative Layout Shift (CLS) | 0.569 | 0.086 | 0.097 |

**Important:** The local preview uses `http://127.0.0.1:43987/` with remote
Supabase/fonts/media, whereas the published audit used Netlify CDN. FCP/LCP,
network retries and score variance are therefore **not comparable**.
The material, directly reproduced win is removal of the large visible
header/content jumps: both updated CLS results fall below the 0.1 target.

## Root causes and remedies

1. `assets/js/privacy-consent.js` inserted a relative banner after the header
   once the page had painted; `assets/css/design-system.css` also forced that
   banner into document flow with `!important`. Both now use bounded,
   scrollable, fixed bottom-sheet positioning above the mobile tab bar.
2. `assets/js/notification-popup.js` inserted asynchronous announcements via
   `body.prepend`; the 228–240px notice moved every element down. Now it is a
   constrained, dismissible fixed overlay near the top of the viewport.
3. `assets/css/navbar.css` now pre-hides nav links and actions only while they
   are awaiting migration into the canonical mobile drawer.
4. `assets/css/home.css` now gives social actions a minimum 44 × 44px hit area
   and allows controls to wrap at narrow widths.
5. `assets/css/viewport-guard.css` and
   `assets/css/discussion-enhancements.css` keep long card/media content
   inside its own responsive layout, without hiding interactive content.
6. `assets/js/app.js` now marks ad images `loading=lazy`,
   `decoding=async` and `fetchpriority=low`; the image element no longer
   claims a fabricated fixed natural aspect ratio.
7. `index.html` / `assets/css/blipmood-home.css` now preserve the branded
   hero image's 600:570 approximate native aspect ratio and prioritize loading
   the above-the-fold emblem.

## Responsive browser acceptance

Playwright (headless Chromium) checked 7 public routes
(`/`, `/login.html`, `/chat.html`, `/discussion.html`,
`/marketplace.html`, `/videos.html`, `/profile.html`) at
**320, 360, 390, 768, and 1280 px**: 35 route/viewport combinations.
No page-level horizontal overflow; both asynchronous notices remain
fixed when rendered. The mobile menu opened successfully at 320, 360, 390px.

A fresh `npm run build` passed, including the new regression assertions in
`tests/mobile-layout-stability.test.cjs`.

## Remaining Lighthouse findings

- `get_post_engagement` RPC returns HTTP 404 on production Supabase,
  generating a Best Practices console error. The client has a fallback;
  fixing the server RPC needs its own audited migration, not a CSS change.
- A currently served Supabase-hosted advertising image costs about **2.3 MB**,
  and some avatars exceed 300 KB. Lazy loading helps, but existing files
  should ultimately have uploader-side compression and/or approved thumbnails.
- Some text and post action accessibility labels still trigger a minor
  Lighthouse label-content-name diagnostic in real post counts.
- Third-party font timing affects local LCP and a small remaining CLS portion.
- **Release blocker:** published Netlify deploy remains locked on an older
  build. Promote the Git-based production deploy and re-run Lighthouse at
  `https://blipmood.netlify.app/` to establish real production scores.

## Reproduction

```sh
npm ci
npm run build
npx http-server dist -p 43987
npx lighthouse http://127.0.0.1:43987/ --output=json \
  --only-categories=performance,accessibility,best-practices,seo
npx lighthouse http://127.0.0.1:43987/ --preset=desktop \
  --output=json --only-categories=performance,accessibility,best-practices,seo
```

The actual regression test is fully offline; no database or production
configuration was changed by the responsive patch.
