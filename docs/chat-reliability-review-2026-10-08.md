# Chat and notification reliability review — 8 October 2026

This follow-up extends the [sitewide design and production review](sitewide-review-2026-10-08.md). Changes are on the existing draft [PR #3](https://github.com/Timzee00/timzee-tech-blog/pull/3). Production remains deliberately locked; no live data, database policies, or hosting settings were changed in this pass.

## Defects repaired

| Trigger | Previous behavior | Current behavior |
| --- | --- | --- |
| Open A, switch to B, then return to A while the first request is pending | An older history response could replace the current conversation | Each selection has a generation; history and profile completion must still belong to that selection |
| Switch with an unsent message or attachment | The shared composer could lose or carry text into another conversation | Text and file drafts belong to the conversation for the lifetime of the page; object URLs are retired when previews change |
| Send, then switch before the request finishes | Pending work could interfere with another draft | The request keeps its original recipient; success clears only the matching sent draft; failure retains it for a deliberate retry |
| Realtime disconnect or rapid switching | Channel retirement, timers and stale callbacks could overlap; the interface could imply a connection prematurely | One controller owns the subscription, retires previous channels, cancels obsolete callbacks and retries with bounded exponential delay and jitter |
| A message is edited or the connection resumes | Only INSERT events were handled; recent history was not reconciled after reconnect | INSERT and UPDATE merge by message ID; reconnect fetches the latest 50 rows and retains loaded history; a newer event wins over an older catch-up snapshot |
| Read older messages while an update arrives | Rendering forced the viewport to the bottom | Incoming updates preserve the current scroll position unless the reader is already near the bottom |
| Find someone who is not already a contact | “Find people” filtered only cached contacts | Debounced, composition-aware public name/username search, at most 20 results, with stale-response protection; no email directory search |
| Type into the inbox filter | Every render downloaded message previews again | Filter and selection rendering use a local preview map, updated by loaded and sent messages |
| More unread notifications than the REST row limit | Downloading IDs and counting returned rows understated the unread count | An exact HEAD count returns the total without transferring notification rows |

Composer controls are disabled while a conversation is loading. The status text distinguishes Loading, Connecting, Connected, Reconnecting, Offline and load failure. Notification and group-mute preferences govern new-message toasts.

Removed the broken member typing/presence implementation and its unused chat-specific markup/styles. Its old random per-client channel names could not share those events. Predictable public channels would expose member activity without authorization, so private membership-authorized channels are a prerequisite for reintroducing that feature. The AI assistant's separate typing indicator is retained. Database message subscriptions continue to depend on the deployed row policies.

## Verification

Node 22 validation passed: **102 syntax checks, 49 unit/backend/SQL tests and 170 desktop/mobile browser tests**. The production build and `git diff --check` passed; `npm audit` found **0 known vulnerabilities**. This pass adds five controller tests and sixteen browser cases. See the cumulative evidence in the [sitewide review](sitewide-review-2026-10-08.md#verification). The focused browser cases run in Chromium desktop and Pixel 7 emulation with intercepted APIs and synthetic accounts. They cover:

- A → B → A history completion out of order.
- Per-conversation text and attachment drafts.
- A pending send completing after switching to another draft.
- Failed sends retaining text and allowing an explicit retry.
- Discovery outside the existing contacts, old search results arriving late, clear behavior, the selected public columns and 20-result bound.
- Inbox filtering without extra message queries.
- An unread total of 1,500 obtained with HEAD and `count=exact`.
- An edit arriving during a reconnect fetch, without duplicate rows or stale snapshot overwrite, and honest connection status.

The controller's unit cases also exercise channel retirement, rapid switching while retirement is pending, old callbacks, wrong-thread payloads, offline behavior, retry backoff and timer cleanup. Existing pagination/duplicate-send, shared layout, accessibility, backend security and SQL checks remain in the full suite.

## What this does not establish

1. **Live permissions and delivery:** no live two-user Supabase/RLS, blocked-user, private Storage or device-network test was performed. Validate these in an isolated staging project. The existing preview points to the production backend and serves an earlier commit.
2. **Complete missed-event recovery:** reconnect refreshes the latest 50 messages. A longer disconnection can leave a gap until reopening or loading appropriate history. Remote DELETE events are not reconciled in place; reopening fetches authoritative history. Large-gap resynchronization and deletion behavior remain follow-up work.
3. **A scalable inbox backend:** preview loading still uses the existing ordered multi-thread query, subject to the server row cap. High-volume threads can crowd out another thread's preview. Friend/group lists still need measured pagination and a latest-message-per-thread query/index design. Caching removes repeated requests but does not fix that backend limitation.
4. **Persistent drafts:** drafts and attachment references live only in memory. Reloading or closing the page loses them. A pending failed send is not retried automatically, because ambiguous delivery needs a durable idempotency strategy.
5. **Media and rendering cost:** message markup is rebuilt on updates, which can restart media playback. Signed-media refresh and legacy public objects still require the checks and migration in the main review.
6. **Million-user capacity:** exact counts still consume database work; check query plans/indexes, RLS cost, service quotas, fan-out, latency and recovery under representative load. No throughput claim follows from these local regressions.

Hosted CI remains blocked by the GitHub account billing lock previously documented. Review commits include `[skip netlify] [skip ci]`; the existing explicit Netlify ignore command suppresses these Git builds. This pass does not unlock, merge, or deploy production.
