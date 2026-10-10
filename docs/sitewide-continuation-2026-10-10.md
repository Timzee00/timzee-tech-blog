# Full-site redesign and release continuation — 10 October 2026

## Scope

Continue draft PR #3 (`codex/production-readiness`) rather than replacing it. This branch contains site-wide runtime and functional corrections based on a public read-only browser check. It is **not** a production release and is not a declaration of bug-free operation.

## Verified public-preview symptoms (previous preview commit, not this branch)

- Anonymous chat shows an application error toast for a browser ResizeObserver-loop diagnostic.
- Two distinct announcement presentations can display the same announcement and overlap at mobile widths.
- Popular-post remote images and empty chat/story avatars appear broken.
- Fixed cookie notice covers the anonymous chat sign-in call to action on a 390px phone.
- The homepage has a several-second startup wait while independent data and auth/settings requests complete.

Public read-only preview: https://deploy-preview-3--timzee-tech-blog.netlify.app/ . That preview is behind this branch and must not be used as evidence that these fixes have already deployed.

## Changes on the continuation branch

- Run `site-shell.js` exactly once for all built public pages, sharing footer, cookie preferences, common navigation, form controls and other enhancements; exclude staff-only workspaces.
- Update nav-height measurements on animation frames only when values differ and avoid a false application-error toast for the browser's nonfatal ResizeObserver-loop diagnostic.
- Avoid overlapping legacy and current announcement presentations.
- Place the mobile cookie notice in normal document flow beneath the header so content and sign-in controls are not covered.
- Supply local avatar placeholders and replace failed popular-post images with styled text fallbacks.
- Start independent homepage auth and settings requests together and cancel stale timeout warnings.
- Add source-level and browser-level regression checks.

## Remaining acceptance matrix (not yet verified against isolated live staging)

| Area | Required end-to-end evidence |
| --- | --- |
| Home, search, discovery | Fast useful paint; correct categories, ranking, search, pagination, images, empty/retry states |
| Auth, profiles, settings | Email/password, recovery, OAuth, all roles, visibility settings and authorization between separate users |
| Posts and communities | Create/edit/delete, comments, likes, follows, reporting, discussions, announcements and notifications |
| Chat and groups | Two-user messages, voice/audio, uploads, privacy, reconnect after long gaps, deletes, mentions, group membership, blocked contacts |
| Stories, videos, novels | Upload/play/view/delete, creator controls, accessibility, storage policies and large media behavior |
| Marketplace | Listing create/edit/sold-out, inquiry, seller contact, moderation and permissions |
| AI and staff workflows | Provider success/error cases, usage limits, admin/moderator/curator tools and role boundaries |
| Quality and operations | Phone/tablet/desktop accessibility, automated tests, real RLS/Storage audits, staging integration, backups, rollback and capacity budgets |

The source/browser suites can use synthetic accounts and intercepted APIs, but those results cannot certify external provider delivery or production RLS. No live messages, users, media, announcements or database policies were changed. Netlify commits include `[skip netlify] [skip ci]` to protect constrained build/CI budgets.
