# Blipmood personal chat actions — 27 October 2026

## Behaviour
- **Clear chat for me:** a personal UTC cutoff hides messages at or before the clear action on all of that user's devices. Message/media rows are NOT deleted. Other DM participants and other group members retain all their history. New messages after the cutoff remain visible and deliverable. This action is not reversible.
- **Archive chat:** moves a direct message or group conversation from normal lists to the **Archived** filter. Archiving automatically mutes that conversation for that account. New messages don't automatically unarchive it.
- **Unarchive:** moves the conversation back to its normal list. It deliberately keeps notifications muted until the member explicitly selects **Unmute notifications**.
- **Mute/unmute:** account-specific control on both DMs and groups; group-level pre-existing mute values still apply until explicitly overridden.
- **Clear while archived:** continues to work; stays archived and muted.
- The **three-dot chat menu** provides Archive/Unarchive, Mute/Unmute, and Clear Chat for me for both direct/group conversations. The Archived tab contains archived DMs and groups.
- Sender/recipient counterpart's archive/mute/clear settings are never mutated.

## Server integrity
Applied Supabase migration `20261027194532_personal_chat_clear_archive_mute`, with matching repo SQL file:
- `public.chat_personal_views` is user-owned and has authenticated SELECT-only RLS.
- `public.set_chat_personal_view` validates group membership or canonical sorted-UUID DM id and only mutates caller's row. RPC revoked from anonymous.
- A **restrictive SELECT RLS** policy on `direct_messages` prevents cleared old rows from being fetched by that user. Other users' SELECT and posting rules are unchanged.
- `notify_direct_message_event` checks only the recipient's mute/archive state; web push is downstream of normal notification insertion. Group alerts already use the chat member mute path where applicable.
- No destructive operation touches `direct_messages`, group memberships, or other users' preferences.

## Validation
- Regression tests: `node --test tests/chat-personal-controls.test.cjs`.
- Source sanity: original `chat-v2.js` parses when module imports are excluded (the tests assert this).
- SQL presence, RLS mode, grants and message-notification behavior verified in connected Supabase.
- **Requires two signed-in test users for production E2E:**
  1. Start DM A/B, clear on A. A sees no old messages, B retains every old message.
  2. B sends a new message. A sees the new message; neither user's history is deleted.
  3. A archives and mutes B. A sees the thread only under Archived; no A-side direct-message notification or push is queued.
  4. Confirm B's notifications and conversation remain unaffected by A's actions.
  5. A unarchives then explicitly unmutes; subsequent B messages notify A again.
  6. Repeat personal clear and archive on group A/B/C; other members' histories remain intact.
  7. Test mobile widths 320/390/768 and desktop; accessible Archived tab scroll and menu navigation.
  8. Test the latest git deploy; manually published older Netlify Drop builds will not contain this release until publishing.
