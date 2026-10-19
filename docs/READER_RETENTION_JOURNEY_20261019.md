# Timzee Tech Hub — Returning Reader Journey (2026-10-19)

## Purpose
Increase useful return visits without dark patterns, paid recommendation APIs,
email spam or repeated code across blog, profile and feed screens.

## Delivered in development PR #7
- **Continue Reading** on the signed-in homepage: latest 6 unfinished published
  articles, approximate completion and one-click return to the saved position.
- **My Saved → Continue reading** on a private profile: up to 8 unfinished
  reading positions plus per-article forgetting, without deleting bookmarks.
- **From creators you follow**: most recent published posts from the existing
  `follows` graph (no new accounts or subscription tables).
- **Picked for your interests**: transparent matching of the user's existing
  `community_user_interests` with already-loaded homepage posts' tags, title
  and category. No black-box boost or extra article fetch; respects the
  existing `feed.showRecommendations` preference and avoids duplicate cards.
- **Article progress control**: a lightweight in-page progress indicator and
  resume shortcut. Approximate scroll completion is recorded only after the
  signed-in reader reaches the article body; no recording for logged-out visitors.
- **Privacy & accessibility**: `Settings → Reading history & continuity`
  lets a user stop new progress recording and erase all stored reading
  positions. Privacy Policy explains the storage; preferences sync across
  devices. Progress and following cards honor reduced motion and mobile widths.

## Database
Migration: `supabase/migrations/20261019095000_reader_journey_private_progress_following.sql`
**Already applied** to Supabase project `duvbcwwprkzzyzikmcol`.
- `article_reading_progress` has a composite user/post primary key,
  foreign-key cascade cleanup, row-level security and a partial resume index.
- Only the member can SELECT/DELETE the member's history. Browser clients
  cannot directly INSERT/UPDATE progress rows.
- `record_article_reading(post_id,percent)` verifies the user, published
  article, 1–100% boundary and server-saved privacy preference.
  The function throttles redundant writes and monotonically preserves the
  highest recorded completion.
- `reader_following_articles(limit)` is a SECURITY INVOKER query with a
  capped 12-row result, following/visibility checks and creator-follow indexes.
- Both RPCs are unavailable to the anonymous database role.
- Deleting an article/user cascades to dependent progress rows; clearing a
  member's reading history does not delete bookmarks.

## Modules and reliability
- `assets/js/reader-journey.mjs`: one API for reads/writes/forgetting and
  bounded scroll-event progress updates; transient sync retries are capped.
- `assets/js/reader-home.mjs`: homepage UI; does not delay public articles.
- `assets/js/reader-library.mjs`: reusable private saved-tab list.
- `assets/js/reader-interest-ranker.mjs`: deterministic, testable scoring
  from existing interests and existing post data; no paid model token usage.
- `assets/css/reader-journey.css`: theme-aware, responsive, no fixed-width
  cards; reduced-motion safe.
- `tests/reader-retention.test.cjs` and
  `tests/reader-interest-ranker.test.cjs`: unit/regression contracts.
- `tests/browser/reader-journey.spec.cjs`: desktop/mobile browser acceptance
  with mocked authentication and public content.

## Production acceptance (NOT yet completed)
1. On Node 22, run `npm ci --ignore-scripts && npm run build && npm test`.
2. Run `npx playwright test tests/browser/reader-journey.spec.cjs` on an
   accessible preview at widths 320, 390 and 768, and check keyboard navigation.
3. With two real test accounts, read a published article to ~30%; navigate
   away and return as the same user on another device. Confirm resume progress
   is private and does not change article view counts.
4. Follow an author; verify newly published articles appear in the following
   rail. Unfollow; verify they disappear on next refresh.
5. Choose two technology interests, verify only relevant published cards are
   recommended. Disable recommendations; verify interest cards disappear.
6. Disable reading progress in Settings, open an article in a new session and
   confirm no new rows are inserted. Clear existing history and verify no
   entries remain while bookmarks persist.
7. Test profile-to-profile cross-user access with an authenticated account;
   neither user may read or delete the other's positions.
8. Simulate offline mode, failed RPCs, expired sessions and slow 3G; public
   articles must still render and the reader UI must fail softly.
9. Confirm page sources are bundled correctly and security scans flag no new
   exposure of Supabase service credentials or profile IDs.

## Known constraints
- The frontend remains on an unmerged development PR; Netlify production
  cannot be claimed as updated. GitHub hosted CI remains unavailable due
  to account/billing limitations, so the complete build and browser suite
  need an alternative runner or an accessible local/preview environment.
- Reading history applies to article content, **not** videos, stories or
  forum posts. Do not represent it as a universal watch-history system.
- Recommendation quality depends on authors publishing and using meaningful
  tags. With no interests/followed creators/history, a simple onboarding
  prompt directs readers to articles and interest settings.
- There are no compulsory streaks, artificial ranking boosts or
  unconsented re-engagement emails.
