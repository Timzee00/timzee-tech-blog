# Staff-first direct messaging and relationship semantics — 15 October 2026

## Product distinction

- **Follow** is one-way interest in a creator's public posts and videos. It never creates a friendship or DM permission.
- **Friend request** is a two-way relationship, which takes effect once the recipient accepts. The recipient's \`allow_requests\` preference controls availability in the UI.
- **Official staff DM** is an independent permission for active moderators, admins and super admins to initiate an ordinary one-to-one conversation without a friendship first. They can still send friend requests separately.
- The recipient can reply without becoming friends. Staff messages identify the sender as staff in chat and in the notification title.
- Users can block staff and change \`allow_messages\` preferences; neither is bypassed by staff. A suspended or demoted staff member loses the exemption.

## Server side — applied to live Supabase

- \`20261015114500_staff_direct_messaging_permission.sql\` deployed. \`can_start_staff_dm()\` uses the live \`public.profiles.role\` and \`account_status\`, not user-edited client metadata.
- \`can_send_direct_message(uuid)\` checks signed-in sender, active target, \`allow_messages\`, two-way friendship blocks, accepted friendship, staff privilege, or replying to a DM previously initiated by currently active staff.
- A BEFORE INSERT trigger \`direct_message_permission_guard\` prevents unauthorized direct messages, checks the deterministic chat thread identifier, preserves existing group-chat routing and enforces a daily staff anti-spam limit. A restrictive RLS INSERT policy provides an additional check.
- The private \`staff_dm_initiations\` ledger audits the first unsolicited outreach by each staff member to each target; it logs participant IDs and time, not message content. Staff cannot view other users' conversations by virtue of role.
- \`20261015120000_direct_message_notification_links.sql\` deployed. Direct-message notifications now link to \`/chat.html?user=<sender-id>\` (which the chat page actually accepts) rather than the previously ineffective \`?thread=\` pair identifier.

## Client side — committed to development branch only

- \`profile.js\`: a verified staff-only \`Message as staff\` button on eligible profiles; independent \`Add Friend\` button remains.
- \`chat-v2.js\`: **Find people** independently offers messaging and friendship requests. Friend requests closed does not disable eligible staff contact. The regular members' UI does not expose the staff shortcut.
- Existing direct partners are loaded from each user's own sender/recipient messages, so staff-first conversations appear in BOTH inboxes. Privacy, blocking and role permissions are checked by an authenticated RPC before opening and again before uploading or sending attachments; database trigger enforces final permission at insertion.
- Staff messages have a visible staff label in conversation list/header. \`chat-v2.css\` protects touch targets and wrapping on narrow phones.
- \`tests/staff-direct-messaging.test.cjs\` covers staff vs ordinary users, blocks, recipient opt-out, pending friendships, recipients replying, closed friend requests, and notification links.

## Verified, without sending a message

- Migration deployment returned success. DB has the audit table with RLS, exactly one active DM permission trigger, and anonymous caller cannot execute staff permission checks.
- Direct SQL role checks using a real active staff-role sample and ordinary-member samples confirmed: staff can initiate with an eligible unconnected user, ordinary cannot initiate with an unconnected user, ordinary does not inherit staff status.
- Synthetic client rendering verified: staff can message AND request friendship, ordinary must request, a blocked account cannot message, message opt-out disables the shortcut, and a regular recipient with staff DM history can reply.
- Staff DM audit initially zero; no real user messages sent.

## Release and follow-up

- The frontend is **not deployed**. Existing Netlify Deploy Preview will still use its older code until rebuilt; user reports exhausted credits.
- GitHub Actions remain blocked by account billing; local/synthetic tests are not substitutes for a two-account browser integration check.
- On fresh deployment, test on mobile with 3 accounts (staff, ordinary, another recipient): staff DM without friendship, reply, block, opt-out, pending request, demotion, notification open, and group-chat regression.
- Do NOT interpret this privileged access as permission for unsolicited marketing blasts. No marketing emails were sent or activated.
