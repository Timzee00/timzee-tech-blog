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

## Audio expiry worker
The existing five-minute `automation-maintenance` schedule now cleans expired
live audio rooms. It sends LiveKit DeleteRoom before marking the room ended in
Postgres; 404 (already gone) is also accepted. Work is bounded to eight rooms
per tick, with a short provider timeout. Provider/database failures are raised
for scheduled logs/retry, not silently marked successful. This worker is
inactive while Netlify remains paused. Real provider integration testing is
required after credentials are configured.

## Scoped room discovery
Live, Upcoming, Mine and context-linked room queries now filter on the server
before applying a 50-row cap. This prevents unrelated scheduled or private
rooms from crowding out a user's selected view. Stale responses after tab
switches are discarded, expired rooms are not promoted as live, and RLS
continues to determine visibility. Full browser pagination and mobile QA are
still release gates.

## Workspace role presentation
Creator/company team viewers can now inspect full collaborative project notes
in a read-only preview. Editing, Space planning, and project approval controls
are hidden for roles without permission. Editors revising approved projects
submit them back to team review; only owners/admins may re-approve via the
existing database trigger. RLS remains the security boundary, not the UI.

## Reliability repair: independent media expiry worker (2026-10-23)
The previous 5-minute `automation-maintenance` chain could exit before it
attempted LiveKit shutdown when an unrelated publisher, verification or
founder digest RPC failed. LiveKit expiry now has an independent function,
`spaces-expiry-worker`, scheduled every five minutes in `netlify.toml`.
It uses the existing bounded `expireSpaces` helper: provider shutdown must be
confirmed before recording room status `ended`, and failures remain visible
for retry. The old maintenance chain no longer duplicates this operation.
The schedule is inactive while the Netlify site is paused; free-tier function
invocation budgeting must be reviewed before resuming.

## Ended-room provider reconciliation
A room already marked ended may still have active media tracks if the host's
first DeleteRoom call failed. The Confirm audio stopped control now retries
the authorized provider deletion for previously live or already-ended rooms.
A never-started scheduled room is cancelled without requiring audio. Deliberate
Leave/Reconnect clears the active room reference before disconnect, preventing
a false network-failure message from the provider event callback.
