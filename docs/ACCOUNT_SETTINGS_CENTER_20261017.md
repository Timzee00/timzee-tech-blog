# Timzee Tech Hub — Functional Settings Center

Updated: 2026-10-17. Changes are in PR #7. **Do not treat as deployed to main** until Netlify is unpaused and the signed-in release checklist is completed.

## Architecture

Existing `settings.html` and `assets/js/settings-page.js` remain the single account settings entry point. `assets/js/settings-advanced.js` adds searchable, responsive account controls and uses the existing autosave pipeline.

| Group | Real persistence or behavior | Scope |
| --- | --- | --- |
| Account/profile | Profile editing shortcut; `profiles` privacy and notification columns | Supabase RLS own profile |
| Appearance/accessibility | `appearance.theme`, `fontScale`, `contentDensity`, `reduceMotion`, `highContrast` | `user_settings.preferences` and immediate UI via `timzee:preferences`, restored from local cache |
| Privacy & safety | Allow messages, friend requests, email visibility | `profiles` columns |
| Chat privacy | Read receipts, online presence | `chat_privacy` own row and existing chat consumers |
| Notifications | Messages, replies, follows, mentions | `profiles.notify_*`; existing setting writer |
| Announcement banners | Optional banner display, dismissible without changing security emails | Account preference `notifications.announcements`, loaded in `notification-popup.js` |
| Email digests | Message/mention/community/marketplace/inactivity opt-in | `email_notification_preferences`; **sending** still requires scheduled worker, consent and deployed config |
| Tech interests | 14 topic choices matching database whitelist | `community_user_interests`, used by personalized forum recommendations |
| Feed | For You/Following, feed recommendation opt-out, remembered filters | `user_settings`, honored in `fyp.js`; opt-out also honored in forum |
| Communities | Default Active/New/Top/Unanswered sorting; live thread update preference | `user_settings`; forum reads it and subscribes to thread events only while applicable |
| Chat/groups | Existing notifications, Enter-to-send, compact mode and group tags | Existing supported `chat-v2.js`/site consumers |
| Marketplace/novels/video | Existing location/reader/media options | Existing supported experience-preference consumers |
| AI | Whether to pass page context on supported assistant actions | Existing `user_settings` |
| Account security | Reset password, change password, sign out, sign out all sessions | Supabase Auth |
| Cookies | Existing cookie manager | Consent storage controls; optional measurement requires consent |
| Data | Preferences JSON export; validated JSON import; scoped settings/activity snapshot; delete own recommendation feedback; clear followed interests | Browser download + RLS-backed Supabase operations |

Unsupported ideas like fake per-platform privacy guarantees, unrestricted complete data export, one-click data deletion, browser-push delivery without implementation, sound toggles without playback consumers, and mandatory email marketing consent switches are deliberately **not** advertised.

## Security and privacy

- User-owned tables already use Supabase RLS (verified on live project): `user_settings`, `chat_privacy`, `community_user_interests`, `community_feed_feedback`, `user_content_feedback`, and `email_notification_preferences`.
- Advanced settings never use Supabase service keys or read other users' private rows.
- The account settings snapshot exports only explicit own-account columns and bounded results. It **does not** claim to be an exhaustive legal data-portability export. It contains profile and preferences data; remind members to store it safely.
- Import only accepts recognized setting keys, correct primitive types, whitelisted enum values and small files; account identity and profile privacy permissions are excluded from import.
- Interest toggles write one selected topic at a time and revert on backend failure.
- Chat privacy toggles persist both fields together and revert on backend failure.
- Recommendation-feedback reset prompts for confirmation, deletes only the signed-in user's feedback in both supported feeds and surfaces partial failure instead of falsely claiming success.
- Appearance changes preview immediately through local cache, then save to the account. The UI reports server save failures.
- Email opt-ins are separate from in-app notification switches, and activation of Brevo email jobs remains governed by deployment and consent requirements.

## Cross-page integration

- `theme-init.js` handles light/dark/system, 90–125% root text scaling, density, reduced motion and high contrast.
- `notification-popup.js` respects the optional `notifications.announcements` setting.
- `community-forum.mjs` reads `discussion.defaultSort`, `discussion.showLiveUpdates`, and `feed.showRecommendations`; realtime subscriptions are scoped to the open thread and suspended while the tab is hidden.
- `fyp.js` already respects `feed.showRecommendations`, `feed.defaultFeed` and `feed.rememberFilters`.
- The old discussion sort options `trending` and `popular` have been aligned with the redesigned forum's actual active/new/top/unanswered sorter.

## Release gates

- [x] Settings module created and wired to existing single account autosave.
- [x] Responsive navigation, interest chips, search field, text preview, and data-controls section.
- [x] Tech-interests and chat-privacy RLS-backed reads/writes.
- [x] Appearance applied site-wide using existing theme initialization.
- [x] Actual forum and banner consumers now honor supported preferences.
- [x] Source parse tests and preference validation checks; `tests/settings-center.test.cjs` included in `npm run check`.
- [ ] Run exact PR-head production build and all Node tests in the deployed environment.
- [ ] Confirm one account's changed settings persist in another browser/device.
- [ ] Two-account chat presence/read receipt tests (privacy opt-out from one user must be honored for the other).
- [ ] Confirm setting all tech interests on/off changes `community_user_interests` and subsequent personalized community rankings.
- [ ] Confirm forum sorting and realtime off behave correctly across refresh/tab suspend.
- [ ] Confirm announcement banner opt-out doesn't suppress essential account/security email.
- [ ] Verify optional email choices persist and live workers only deliver when enabled/consented.
- [ ] Test settings page at 320, 360, 390 and 768px, light/dark/high contrast, large text and screen reader.
- [ ] Test failed network saves, malformed JSON import, forbidden export rows and RLS checks as anonymous users.
- [ ] Merge only after checks. Netlify deployment is currently paused due to exhausted credits.

## Honest limitations

No complete regulatory data export/deletion workflow or device-session management dashboard is implemented in this release. Supabase Auth sign out-all and password reset/change flows remain operational controls rather than promises of a session-management UI. Some experience settings only affect surfaces that currently consume the preference. Browser notifications and marketing automation require separate delivery infrastructure and explicit consent.
