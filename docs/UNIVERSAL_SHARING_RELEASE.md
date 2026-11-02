# Blipmood Universal Sharing — release notes and acceptance checks

## Shipped architecture

- Android Web Share Target: installed Blipmood PWA, `POST /share-target`, service-worker interception, with up to six supported images or one video, 45 MB combined.
- Media, title and text are placed in **device-local IndexedDB for at most 24 hours**. Share payloads, auth tokens and private media are not written to URL parameters, public CacheStorage, Netlify Functions or the Blipmood database on receipt.
- The review screen (`share-inbox.html?id=UUID`) lets the signed-in user choose Status, Chats & Groups or Community Post. A user must explicitly confirm publishing/sending.
- Direct/group messages reuse `can_send_direct_message`, `direct_messages`, the chat-media private bucket/signing path, RLS and group insert triggers. Recipient selection is bounded to known friends and joined groups; files use separate uploads per target to avoid bypassing private-media authorization.
- Statuses reuse `createStory` and its existing `publish_story` RPC, expiry and visibility checks. Link/text-only shares receive an original generated image card. No unlicensed music audio is downloaded or rehosted.
- Community Post opens the existing composer with the share prefilled; community rules acknowledgement and destination selection are required before publishing. Successful insert removes that device-local draft.
- Spotify titles and image previews are fetched from the documented public oEmbed endpoint when available. Art is shown only as a preview, not downloaded into posts; outgoing status links get a deliberate **Open on Spotify** action.
- Delivery attempts use persisted message UUIDs, known-success markers and uncertain-delivery markers to minimize duplicate sends after interrupted network operations.

## Before treating the feature as live

1. Run `npm run check` and `npm run build` on the exact committed main SHA. Check Netlify production deploy points to that same SHA.
2. On **Android Chrome**, uninstall any old Blipmood PWA, load the updated site, install and confirm Blipmood appears in the system Share menu. Some installed PWAs require reinstalling after new manifest capabilities are added.
3. Share a Spotify track link. Confirm the inbound review page displays the source link and optional album art. Choose Status and confirm it publishes a link card, **does not play Spotify audio**, and shows a working Open on Spotify action in the story viewer.
4. Share one JPEG, one MP4 and multiple small photos from Gallery. Confirm Status and Chat reject multi-photo shares without silently dropping content; Community accepts supported photo collections.
5. Share a link to one accepted friend and an allowed group, then verify with the recipient accounts. Test a blocked friend, a removed/suspended group member, and an admins-only group; the server must deny restricted sends.
6. Switch to Friends only on a status; verify a friend can view it but an unrelated account cannot. Check that no private soundtrack/photo is publicly accessible through share previews.
7. Simulate lost connectivity before send, during send and after server insert. Ensure successful recipients are not retried automatically and uncertain deliveries are not resent without verification. Check orphaned uploads and Supabase free-tier quotas.
8. Test long links, malformed schemes, 45 MB boundaries, insufficient device storage, expired drafts, sign-out/sign-in return, one-handed viewport use and TalkBack/keyboard focus.
9. Confirm the `share-inbox.html` page and its random IDs are absent from public search results and the user can discard a pending share.
10. Check iOS/Safari and other browsers gracefully: they may allow outbound web sharing but **not** Android-style PWA incoming Web Share Target.

## Rights and privacy limits

- Spotify's Developer Policy does not permit general-purpose messaging use of Audio Preview Clips. Use licensed audio or official Spotify-controlled embeds only where their terms allow; **do not imitate WhatsApp's short preview by copying Spotify audio**.
- Incoming content may occupy significant local storage until discarded or expired. The PWA store is not an encrypted vault. Android can evict it under storage pressure; never pretend a share is already delivered.
- This feature does not grant a user the right to publish copyrighted photos, video or music, and does not remove existing RLS safeguards.
- Audit logs should record errors and counts, not message bodies or locally shared file data.

## Rollback

If a severe share-target issue is discovered, deploy the previous static site/SW/manifest together. Do not weaken the private storage bucket or RLS policies. An in-progress local share may become unreadable after rollback; alert affected users. No schema migrations or new environment secrets are required by this change.
