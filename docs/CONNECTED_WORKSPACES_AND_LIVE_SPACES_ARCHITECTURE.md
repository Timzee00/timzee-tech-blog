# Connected workspaces and Live Spaces — implementation contract

Status: Creator Studio, team workspaces, Spaces UI, RLS and server token handling exist on main, but **live-provider audio and full E2E remain unverified on paused hosting**.
All features share one authenticated identity but have separate permissions and budgets.

## Identity and access
- Personal accounts remain separate from organisation membership.
- Organisations have owner, admin, editor, analyst and member roles, granted only by trusted server-side mutations.
- Creator workspaces own drafts, series, media, analytics and scheduled publications.
- Organisations own teams, brand pages, job posts, approved campaigns, announcements and moderation queues.
- Workspace switching must never change effective permissions without a server-side membership check.
- Enforce Supabase RLS on every exposed table, including membership and invitations; never trust client-provided owner IDs.

## Connected content
Article -> discussion thread -> optional Live Space -> recording/transcript (opt-in only) -> recap -> follow-up article.
A creator can publish to their profile or a workspace when authorised; a company may sponsor a discussion but cannot edit user comments.
All cross-feature links must use immutable entity IDs, preserve attribution, and respect audience visibility.

## Live Spaces
- LiveKit Cloud or self-hosted LiveKit is needed for actual WebRTC audio.
- Server-only LIVEKIT_API_KEY, LIVEKIT_API_SECRET and LIVEKIT_URL; never expose the secret in the browser.
- Server validates Supabase bearer token, room visibility, capacity, bans, membership and speaking role before minting a short-lived token.
- Permissions: host/co-host/speaker/listener; listeners cannot publish audio.
- Host controls: approve hand raise, mute, remove, block, report, end room.
- Presence, emoji reactions and speaking queues may use Supabase Realtime; actual audio must use an SFU, not database events.
- Join muted, explicit microphone consent; reconnect/backoff, device-change handling, network quality states.
- Recordings default off. Obtain explicit consent and enforce retention/deletion rules.
- Start with capped concurrent participants and session budgets; provider free quotas are not guarantees of scale.

## Rollout
1. Migrations and RLS + authorization tests (two unrelated accounts and one organisation member).
2. Creator workspace CRUD, publishing and cross-linked content; accessibility and mobile tests.
3. Organisation workspace invitations, role changes, jobs and audit events.
4. Spaces listing, creation, scheduled events and server-side token endpoint.
5. Real microphone integration and role moderation, reconnection and provider billing caps.
6. Load tests, abuse tests, performance budgets, observability, rollback and incident drills.

## Release gates
- npm ci, npm run check, npm run build, npm test, Playwright browser tests.
- Authenticated E2E across two accounts and an organisation owner/member.
- Validate RLS with anon/authenticated and denied cross-tenant operations.
- Test audio on Android Chrome, iOS Safari, desktop Chrome/Firefox with microphone revoked/poor network.
- Ensure paused Netlify deployment is resumed intentionally only after passing gates.

## Current safety changes
- The browser reads a no-store, boolean-only provider configuration endpoint. Without provider configuration, room scheduling remains possible, but a user cannot start an audio-less live room.
- Expired rooms are hidden from live discovery pending server status cleanup.
- Cancelling a scheduled room does not require an audio-provider delete request.
- Database `spaces_start` now records the actual start instant; credentials and end-to-end audio still require testing.
