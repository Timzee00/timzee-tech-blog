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


## Follow-up: authentication, announcements and chat media

The continuation now deduplicates **concurrent** `getCurrentUser()` calls without caching results after completion, removes the legacy announcement-loader import, and rejects stale announcement refresh responses. Three focused Node 22 single-flight tests passed.

### Confirmed chat attachment defect and source fix

The existing `chat-media-sign` endpoint authorizes recipient renewal by finding an actual message with a matching `direct_messages.media_path`, with the sender matching the path owner. Yet `chat-v2.js` previously inserted only `media_url` (a temporary signed URL). A recipient could therefore lose access when the URL expired. New sends now include both `media_url` and the durable, validated `media_path` in the same message INSERT. The validator rejects public-bucket URLs and unexpected private paths.

Two focused Node 22 path-extraction tests passed; a Playwright regression was added to assert the outgoing message's `media_path`, but the full browser suite and live two-account renewal are **not yet run**. Old messages missing `media_path` need a separately verified backfill, not guesses based on expired URLs.

### Read-only production storage and RLS observations (10 October 2026)

- `chat-media` is **private**, with 25 objects.
- `media` is **public**, with 120 objects; 11 use the old `direct-messages/` folder.
- `direct_messages` has 88 rows; 25 have `media_path`. The currently checked URL pattern for old public links matched zero rows; this does **not** prove those 11 objects are unused.
- Storage RLS policies `auth_upload_comments` and `auth_upload_user_media` still explicitly allow `direct-messages` under the public `media` bucket. These policies must be revised in a reviewed staging migration to prohibit future private uploads into the public bucket while preserving the other allowed public folders.
- No live objects, records, policies, grants or migrations were changed.

**Do not delete the 11 public objects** before a backed-up reference inventory spanning messages and any other content tables, a tested transfer/URL update, access verification for both sender and recipient, and a rollback method. Once staging exists, verify that nonparticipants cannot sign private chat paths and that neither nonowners nor guests can upload into others' private chat prefixes.

### Regression gate status

- Focused standalone tests run locally: 5 passed (3 authentication coalescing, 2 private-media-path extraction).
- Added browser test for durable-path writes but not executed against a complete local build yet.
- Full source build, authenticated staging, browser suite, hosted CI, and the currently unpublished branch are **not certified**.


## Site-wide follow-up: error feedback, notifications and marketplace

- The global error-toast owner is `assets/js/theme-init.js`. Previously suppressing the nonfatal ResizeObserver diagnostic in `nav.js` was ineffective because `theme-init.js` registered the global handler first. The toast owner now explicitly ignores that browser diagnostic; a browser regression verifies the behavior.
- `notifications-ui.js` and `notification-popup.js` both subscribed to `notifications` INSERT events and could show two popups for one notification. The latter now owns **announcements only**, while `notifications-ui.js` is the sole notification toast subscriber. A source-level regression guards ownership.
- Marketplace used a hidden `currency = "USD"` default, so every created listing appeared in USD even though sellers had no currency control. The create form now offers NGN, USD, GBP, EUR, GHS, KES, ZAR and TZS, defaults to NGN, and persists the selected code. The feed and listing detail both use `formatMarketplacePrice` for consistent localized formatting. Existing USD data is not converted or rewritten.
- An isolated Node 22 harness passed **eight focused tests**: three auth single-flight, two private-media-path, and three marketplace-formatting checks. These are not a substitute for the full repo suites; newly added browser tests for cookie/mobile shell, the global warning suppression and currency persistence remain unexecuted against the new commits.
- Commits retain `[skip netlify]` to avoid unexpected builds. There was no production deploy or live data migration.


## Clean-URL route and navigation consistency

The public site supports both legacy `/chat.html` and clean `/chat` links. Previously `site-shell.js` imported chat, AI and discussion enhancements **only** when `pathname` literally ended in `.html`. The main and mobile nav likewise compared a clean route to a `.html` file, preventing accurate active states. Both now use `pageFileName()`, including correct active login tab behavior. The mobile drawer uses a local avatar placeholder instead of an unspecific external portrait.

An isolated Node 22 test harness verified the updated path utility. As of this update, **10 focused utility tests pass** across authentication coalescing, private chat-media paths, marketplace currency display and route normalization. These do not validate the entire project, and neither the CI browser suite nor new deploy preview has been run for these changes.

## Verified source changes in this continuation

- `3821d05` fixes misleading global error reporting and the duplicate notification listener.
- `d00b28c` adds genuine currency selection on listings, with consistent localized price formatting.
- `189fc54` normalizes clean URLs across shared navigation and page enhancements.
