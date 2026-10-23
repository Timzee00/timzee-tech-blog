# Live Spaces and Team Workspaces — release runbook
Date: 2026-10-23. Branch: main. State: implemented code staged; Netlify hosting paused.

## Implemented foundations
- Live Spaces: public, link-only, and invitation-only rooms, immediate or scheduled starts, discovery tabs, real LiveKit SDK client, server-signed host/speaker/listener grants, microphone permission by role, raised-hand requests, host moderation, participant roster, listener-side mute, room reactions through authenticated LiveKit data messages, per-account room quotas, article and community connections.
- Provider host controls: HTTPS Twirp room deletion and forced participant removal backed by Supabase authenticated ownership, room status and membership checks. Errors are surfaced; changing a DB status alone does not forcibly terminate media.
- Creator and organization teams: create private workspaces, invite by exact username, accept invitation, admin/editor/viewer roles, private team drafts, owner/admin editorial approvals, organization settings. Team event plans can prefill a Space through secure RLS reads.
- Existing personal Creator Studio is preserved. Team creation never issues a verified organization badge.

## Required configuration for real voice
You must connect a LiveKit Cloud project (or supply equivalent trusted self-hosted infrastructure) and set Netlify Function-scoped environment variables:
- LIVEKIT_URL = wss://YOUR-PROJECT.livekit.cloud
- LIVEKIT_API_KEY = your provider key
- LIVEKIT_API_SECRET = your provider secret

Never paste secrets into code, GitHub, chat, the browser console or screenshots.
Existing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY or SERVICE_ROLE_KEY must remain configured in the server-side Functions environment.

Voice rooms cannot connect while Netlify is paused, and no real LiveKit account has been connected. Free-tier minute/participant limits still apply. Current room caps (maximum fifty) are software limits, not a guarantee of provider capacity.

## Security
- The eight new data tables have RLS enabled, and default blanket grants were revoked. Anonymous access is limited to explicitly public room metadata; invitations and membership changes use authenticated RPCs.
- Server-signed 120-second LiveKit JWTs are scoped to a room, current authorized user and one audio role. Listeners cannot publish microphones; hosts and approved speakers can publish microphone tracks.
- Audio sessions are NOT limited to two minutes by the token expiry. Host removal and room shutdown must actively disconnect LiveKit participants. Browser heartbeat provides an additional check, but close/disconnection reliability requires real two-device testing.
- Organization verification and official badges are separate, reviewed identity decisions. Internal team approval is not permission to publish platform news or bypass moderation.
- Rooms, event plans and posts are connected through UUIDs and permission-checked records, not private draft text in URLs.
- Recording and transcription are not enabled. Future implementation must disclose recording and obtain participant consent.
- CDN uses pinned LiveKit SDK reference from jsDelivr, and CSP grants access to LiveKit Cloud only. Self-hosted domains require explicit CSP updates.

## Release acceptance before public announcement
1. Resume Netlify only when ready. Verify deployed commit from /release.json.
2. Set up a dedicated LiveKit development project with server-side credentials; confirm plan and budget limits.
3. Run npm ci --ignore-scripts, npm run build, npm test, then real browser tests with separate accounts and device sizes 320/390/768px.
4. Test anonymous, public, unlisted and invite-only rooms. Non-invited and inactive users must not join or get voice tokens. Removed and ended participants must not reconnect.
5. Two devices: host starts live, listener joins muted, asks to speak, host approves, speaker refreshes role and speaks, host removes attendee and ends the voice room. Verify audio actually stops.
6. Test microphone permission rejection, mobile audio autoplay unlock, sleep/reconnect, host offline, transient network failure, quota exhaustion and provider usage accounting.
7. Test team owner invitations, acceptance, viewers, editors (cannot approve), admins (can approve), deleted member access, and unrelated accounts (cannot access private project content).
8. Audit the existing platform's security advisors, page console, Function logs and actual RLS actor testing before declaring release readiness.

## Known limitations
- Netlify is paused; no deployed, authenticated end-to-end audio session has been run.
- Provider-wide participant-minute budgets, automatic expired-room cleanup, native connection quotas and global anti-spam controls require additional work.
- Audience roster and speaker queues poll. Public discover cards do not yet have a global push system.
- Reports are stored but not integrated into the staffed moderation inbox.
- There are no recordings, replays, transcripts, calendars, reminders, multi-cohost permissions or business billing.
- A broad platform-wide audit of legacy publishing, marketplace, video and messaging features is still pending.
- Static/synthetic checks do not certify a million-user platform.

## Rollback
The schema changes are additive. Revert frontend and Netlify Functions with Git if needed, leave live data backed up, and disable LiveKit credentials for a rapid token-issuance kill switch. An active voice room may still require provider-level termination; removing keys alone does not guarantee it is stopped.
