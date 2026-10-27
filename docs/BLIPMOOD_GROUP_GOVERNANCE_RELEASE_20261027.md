# Blipmood group governance release — 27 October 2026

## Implemented user actions
On a signed-in member's **Chat → Groups → open group → Group details** panel:
- Leave group (any member or admin; creator cannot leave without separately transferring or deleting the group).
- Add existing friends or a member searched by their exact public username, if the creator's permissions permit it.
- Generate and copy a group invite (server-issued random token; 30-day expiration; generating a fresh link invalidates the previous link).
- Join from `/chat.html?join=TOKEN`; guests are redirected to sign-in, preserving the return destination.
- Creator or existing admin: change noncreator members to member, moderator, or admin; remove members without entering a reason; suspend from posting (read-only); suspend from viewing; lift suspensions early; allow a removed member to be invited again.
- Group creator: controls invite links, who can add members, posting/media/poll/slow-mode restrictions, and whether admins may edit group settings or description.
- Delegated group admins: can edit group settings/name/description only after the creator enables the corresponding permission. Avatar uploads remain creator-only.
- Member names in chat messages and membership lists link to their profiles.
- Mobile site search is a header button outside the navigation drawer. It sends a query to the existing homepage search.

## Authoritative database protections
The group-governance RPCs were already installed in Supabase (project `duvbcwwprkzzyzikmcol`):
`leave_chat_group`, `add_group_chat_member`, `manage_chat_group_member`,
`generate_chat_group_invite`, `join_chat_group_by_invite`,
`suspend_chat_group_member`, `lift_chat_group_suspension`,
`chat_group_restriction_status`, `unban_chat_group_member`.

Existing RLS uses `private.chat_group_access` to deny **hidden** members access
to group messages; `enforce_group_posting_rules` blocks all suspended members
from writing. The creator's role cannot be removed or demoted by these APIs.
Creator self-deletion/ownership transfer is deliberately NOT implemented.

This release also adds `update_chat_group_settings` and
`update_chat_group_details` (migration
`20261027141929_group_admin_delegated_settings_and_details.sql`), with:
- `auth.uid()` and authoritative thread creator/admin-role checks.
- No anonymous execute privileges.
- Explicit owner delegation flag `allow_admin_manage_settings` (default off).
- Owner-only modifications to the delegation flag.
- Fixed allowlist of boolean settings and bounded slow-mode options.
- Length validation of name/description.
- Audited mutations in `private.chat_group_audit`.

## Read-only / hidden suspension behavior
- Read-only: can still read group messages, cannot send or edit.
- Hidden: message/media access blocked by database and withheld before fetching
  the thread in the UI. No-view is not just a CSS class.
- Restrictions can be lifted early. UI refreshes permission checks at bounded
  intervals while the group is open and reloads content at expiry.
- Removing someone records a ban; reentry requires an explicit unban first.

## Smoke tests / limits
- `npm run build` passes, including six new group static regression tests.
- Chromium checks: homepage/global search, guest invite login redirect,
  group member-management controls at 320/390/768/1280px with no horizontal
  page overflow.
- Database functions and authenticated/anonymous grants were queried and
  verified. Existing group RLS and posting trigger were inspected.
- **Not yet fully verified**: two or more real signed-in accounts completing
  actual group joins, promotion, invite redemption, suspension, expiry and
  unban. Such integration tests must be run with authorized test accounts.
- Netlify production may still point to an older Netlify Drop deploy; publish
  the matching Git commit before checking the public site.

## Manual integration test plan
1. Create a group as A; invite user B and add user C by username.
2. Grant B admin and confirm B cannot change/remove/suspend owner A.
3. Turn off member-added invitations and confirm C cannot add D.
4. Generate link, join as D, rotate link and verify old link expires.
5. Suspend C read-only for 2 minutes; confirm C can read but cannot send via
   UI *or* a direct REST client.
6. Suspend C hidden; confirm messages and media are denied by RLS. Lift and
   confirm visibility returns; verify automatic expiry works.
7. Remove D (no reason), confirm invite reuse fails; unban, rejoin, then leave.
8. Enable admin settings delegation, let B edit group description, then
   disable delegation and confirm B is blocked.
9. Open member profiles from group messages.
10. Use outside-menu search on phone and confirm the query reaches the feed.
