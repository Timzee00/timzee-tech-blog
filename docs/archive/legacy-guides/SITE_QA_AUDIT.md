# Timzee Tech Hub — Site QA Audit

Date: 17 September 2026

This audit separates what was verified from source/database inspection from what still requires a real deployed-browser pass.

## Screenshot checklist coverage

| Checklist item | Current state | Evidence / next check |
| --- | --- | --- |
| Colour contrast | Improved through shared design tokens and visible focus states | Needs deployed Lighthouse/axe verification |
| Alt text on images | Meaningful dynamic images now receive descriptive alt text in upgraded surfaces; decorative UI images may intentionally use empty alt | Needs repository-wide automated image audit plus browser check |
| Refund policy | Added `refund-policy.html` and linked through the shared footer | Review final policy wording with the actual business process before publication |
| Privacy policy | Added `privacy.html` and global privacy/cookie notice | Review business-specific data practices before publication |
| Accessibility | Added `accessibility.html`, skip links, focus styles and responsive containment | Needs keyboard + screen-reader smoke test |
| Fake reviews | No testimonial/review block was found in the repository source search | Recheck after dynamic/content-admin rendering in production |
| Terms & Conditions | Added `terms.html` and global footer link | Review final terms for actual marketplace/business model |
| Third-party embeds | No actual `iframe`/YouTube embed implementation was found in the repository search; CSP permits frames but that is not proof of an embed | Runtime network/DOM audit still recommended |
| Copyright on images | External image URLs exist (including stock/demo image URLs) | Record source/license/permission for every externally sourced commercial image before launch |
| Cookie policy | Added `cookies.html` | Match it to actual enabled storage/tracking providers |
| Tracking | Common GA/GTM/Facebook-pixel style tracking code was not found in the repository search | Runtime network audit still recommended |
| Form consent | Public contact, support, newsletter and advertising forms now receive an explicit unchecked consent control and consent timestamp is persisted | Needs browser submission test |
| Local laws | Privacy/consumer wording was made more careful and links were added | This is not legal advice; obtain professional review for the final operating model |
| Clear button labels | Global controls now use consistent compact sizing, radius and focus treatment | Needs visual regression pass across every page |
| Real business details | Public pages identify the operator as Timzee Corp and use the existing support contact | Add formal registration/address/payment details only when confirmed and intentionally public |
| Only necessary data | Public form fields were kept to the fields required by the requested workflow and consent is explicit | Recheck every account/profile/admin form |
| Keyboard-friendly forms | Focus states, labels/inputs, skip links and required consent controls are present | Needs keyboard-only end-to-end pass |
| Unsupported claims | Support/advertising/newsletter copy was revised to remove unsupported service promises and audience assertions | Continue reviewing dynamic/admin copy before publication |

## Design system changes

- Normal action buttons use compact rectangular controls rather than full-width/pill shapes by default.
- Full-width behavior is opt-in through `.full-width`.
- Shared radius tokens now distinguish controls, cards, and status chips.
- Mobile layouts clip horizontal page overflow and preserve natural button width.
- `Powered by Timzee Corp` is injected in the common footer shell together with legal/accessibility links.

## Popular content automation

The homepage popular section is now backed by the `get_popular_posts()` database function. The score uses live likes, comments, shares and views with a recency decay. Popularity is therefore derived from engagement instead of a hand-written `Popular` label.

## Chat redesign

`chat.html` now uses the upgraded full-screen workspace in `chat-v2.js` / `chat-v2.css`:

- full-screen conversation view with responsive mobile back-navigation
- realtime message subscription through Supabase Realtime
- typing broadcast and presence status
- reconnect handling after channel timeouts/errors and network recovery
- voice recording with MediaRecorder and animated waveform display
- attachment preview for image/video/audio/files
- conversation action menu and chat settings modal
- group creation, group photo, group description and owner editing
- group member tags
- group pin/mute membership settings
- conversation info drawer with shared-media area

New direct-message uploads use the private `chat-media` bucket and a server-side signing endpoint. Legacy direct-message objects that were uploaded to the old public `media/direct-messages/...` path still require a one-time object migration/retirement before the media migration can be considered complete.

## Deployment truth

The GitHub `main` branch contains these changes. The current Netlify production deployment known during this audit is older than `main`, so the new design, legal pages, automated popularity ranking and chat redesign are **not considered live until a fresh production deployment is completed and verified**.

GitHub Actions is also a separate concern: the production-gate workflow has recently failed before a runner/step started. That is not evidence that these code changes failed; it means the CI environment has not executed the validator. Do not mark the release green until the validator actually runs successfully.

## Required release verification

1. Deploy current `main`.
2. Run Lighthouse/axe on desktop and mobile breakpoints.
3. Test sign-in, friend request, direct chat, live message delivery without refresh, typing, presence, voice recording, attachment send/view, group creation, group avatar, group tags, mute/pin, and report flow with two test accounts.
4. Verify legacy direct-message media migration/retirement.
5. Run the production validator in a real build environment.
6. Check real external image provenance and confirm actual legal/business details before making public compliance claims.
