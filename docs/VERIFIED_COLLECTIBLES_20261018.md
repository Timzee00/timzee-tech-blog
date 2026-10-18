# Timzee Tech Hub — Original Verified Collectibles

**Development branch:** `fix/mobile-chat-admin-requests-analytics-20261016`  
**Pull request:** #7  
**Review date:** 2026-10-18

## Product direction

Discord's official documentation separates avatar decorations, full-card profile frames, and profile effects. Timzee adopts that **interaction pattern only** using its own original artwork, CSS and colors. No Discord purchase assets, trademarked badges or code were downloaded or embedded.

Original Timzee source files:
- `assets/js/verified-identity.mjs`: one canonical, escaped renderer and bounded public-profile batch lookup
- `assets/css/verified-identity.css`: badge, decorative halo, nameplate, full-profile frame, responsive and motion-safe rules
- `assets/img/timzee-verified-{silver,gold,platinum,business}.svg`: original Timzee identity icons

## Entitlements and trust

| Approved account | Badge identity | Cosmetic palette |
| --- | --- | --- |
| Standard / unverified | No verification badge | Standard avatar only |
| Silver | Silver Verified | Silver metallic theme |
| Gold | Gold Verified | Gold ornamental theme |
| Platinum | Platinum Verified | Platinum iridescent theme |
| Business | Official Organization | Professional jade palette |

Members with active, server-issued verification can choose among **Signature, Royal Library, Aurora, Orbit, Laurel, and Comet**. Styles affect presentation only, not platform privileges or ranking. All six styles automatically inherit the account's authenticated tier color palette.

The user-facing frame gallery allows previewing before saving, restoring an existing selection, and applying through the normal RLS-protected `profiles.frame_style` update. Unverified users cannot assign themselves verification. Badges and effects hide when an expiry timestamp has passed, even if a scheduled background task is temporarily unavailable.

**Important:** Official identity and "Verified Seller" are different things. Marketplace cards and item details now use the actual identity badge; item pages clarify that account verification does not guarantee the safety of a transaction.

## Shared rendering: no more per-page fake checkmarks

The same helper (`verifiedAvatar`, `verifiedName`, `verifiedCommentClass`) is now used on:

- Profile and frame gallery
- Profile friends and chat friend lists
- Chat headers, contact details, members and people picker
- Community topics, topic details and replies
- Article authors and comments
- For You discovery and inline comments
- Video discovery cards
- Full-screen reel creators and video comments
- Marketplace seller cards and listing details

Queries for many authors are **batched** via public profile data, instead of one request per comment. The shared identity cache has a TTL and bounded entries. Client-supplied name, avatar and media values are escaped/validated, and the user cannot claim a higher tier via profile metadata.

## Schema migration

`supabase/migrations/20261018140000_verified_frame_collection.sql` safely extends existing `frame_style` validation to six known styles. It reuses the database's trusted `is_verified` field and profile-to-public-profile sync. It does not change the authentication or role-granting rules.

After application, a read-only live check confirmed:

- 20 profiles with valid frame styles;
- zero unverified profiles retaining a verified-only style;
- no direct anon/authenticated EXECUTE on the frame-validation trigger function.

The new update is **forward-only**. Do not rerun completed migrations against an already migrated production database.

## Automated operations already in the platform

`netlify/functions/automation-maintenance.js` calls the server-owned `process_automation_tick` and `process_verification_maintenance` routines every five minutes when the Netlify scheduled deployment is active. Verification review triage, expiry, reminders and bounded profile visit cleanup are handled on the server. **Approval of a real-person or business identity remains a privileged, audited human decision.**

A paused Netlify deployment does not execute its hosted scheduled functions; infrastructure must be restored before automated maintenance can be considered operational.

## Quality and release requirements

The focused verification regression suite now covers server-issued verification, expired badges, bad image URLs, frame preview/save logic, shared rendering, mobile CSS, reduced motion, verified article comments, reel comments and seller disclosures. The source edits also passed JavaScript syntax checks.

**Still required before merge/deployment:**
1. Run `npm ci && npm run check && npm run build && npm run test:browser` against the entire branch.
2. Mobile screenshots and interaction tests at **320px, 390px and 768px**, dark and light themes, slow network and reduced motion.
3. Verify true signed-in and anonymous flows with test users, especially frame save/restore, comments, cache revocation, video uploads and group headers.
4. Test moderation/verification lifecycle, browser notification preferences and service-role permission boundaries in a dedicated staging environment.
5. Check production hosting and schedules; the preview/live Netlify sites were previously unavailable and were not verified as part of this coding pass.
6. Benchmark queries and reel rendering on realistic large datasets before claiming enterprise scale.

## Reference material

- Discord Avatar Decorations FAQ: https://support.discord.com/hc/en-us/articles/13410113109911-Avatar-Decorations-FAQ
- Discord Profile Frames FAQ: https://support.discord.com/hc/en-us/articles/40775065582615-Profile-Frames-FAQ
- Discord Custom Profiles: https://support.discord.com/hc/en-us/articles/4403147417623-Custom-Profiles
