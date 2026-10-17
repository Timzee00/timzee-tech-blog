# Timzee Tech Hub — Messaging, Moments & Verified Creator Roadmap

This is a delivery matrix, not a claim that all WhatsApp/Telegram/Discord features are finished. Ship changes through authenticated two-account and small-screen testing. Preserve Supabase RLS and minimize hosting costs.

## Already implemented / in the current PR (requires mobile acceptance)
- Chat: editable text and captions within 15 minutes, server UTC clock, linked replies, sender-only unsend, message info, optional read receipts, approximate activity status, pins, stars, text forwarding, message search, attachments, voice notes, emoji reactions, and optional verified Groq translation.
- Groups: roles, group posting permissions, slow mode, pinned messages, polls, member management and tags.
- Stories/status: 24h standard/72h verified max, reactions, saves, public comments, private replies, privacy-scoped reshares/views, polls and per-story permission toggles.
- Story playback: only advance after image load or actual video completion; pause on press/hold anywhere; retry failed media instead of skipping prematurely.
- Photo editor: on-device crop, rotation, colour, text/emoji, touch drawing; exports a new file without destroying the original.
- Verified perks: better 1920px photo export, 72h stories, creator insights, premium chat wallpapers, opt-in chat translation and text formatting.
- Videos: creator-controlled comments and built-in download action, with polls in the comment drawer.

## Acceptance gates (before treating a feature as production-ready)
1. Android Chrome: camera/photo selection, 3G throttling, network loss, status load, 5s/30s clip playback and press/hold on all three story zones.
2. Two accounts: own/other message edit within/after 15 min, UTC/local timezone correctness, group role/slow-mode permissions, notification privacy and read receipt opt-out.
3. Status privacy: friends-only story visibility, resharing, music URL rights, verified 72h limits, polls opening/closing, comment/like/save persistence.
4. Video restrictions: blocked comments both in UI and DB, and show that hiding download does not stop screen recording.
5. Brevo: credentials/sender verification, unsubscribe/suppression rules, cap, explicit consent; no bulk send during testing.

## Still needed — separate real implementation work
- Full video trim/re-encode, waveform/music syncing, stickers & motion graphics baked into downloadable videos, advanced status collage, blur and layer editor.
- A properly licensed searchable music catalog: Jamendo and Freesound APIs are free for non-commercial use, not a blanket commercial social-network music license. Acquire an applicable license and enforce per-track rights before production catalog integration. Creators may upload music only with permission/rightsholder checks.
- Group topics/threads, event/calendar integration, channels and admin approval queues, spam reporting escalation, per-member granular posting bans, direct-chat disappearing messages.
- Scheduled messages/status, voice/video calling via WebRTC plus TURN services, live group audio stages, bot ecosystem, comprehensive message forwarding with private media re-authorization.
- E2EE would require independently designed key management and compatible devices; current Supabase chat is not advertised as end-to-end encrypted.
- Verified creator subscriptions and monetization should follow payment, age eligibility, dispute and tax review; do not promise unsupported boosts in public ranking.

## Verified tier principle
Verification must represent an authentic, accountable identity — not purchase of credibility. Make value tangible: insights, design tools, private real-time translation (opt-in), extended moments, higher-quality uploads, profile visibility controls, bulk post drafts, collaboration tools and responsive support. Apply server-side authorization and fair-use quotas; keep essential safety and accessibility features available to everyone.

## Email operator action still required
The Brevo worker is scheduled in netlify.toml for production and has daily caps, consent and suppression checks. Netlify's EMAIL_DELIVERY_ENABLED was still false when checked. The environment-update API returned HTTP 422 and the browser required login. Set it to true in Netlify Project configuration > Environment variables, then redeploy and verify from Super Admin Email Operations. Leave EMAIL_INACTIVITY_ENABLED off until separate opt-in testing is complete.
