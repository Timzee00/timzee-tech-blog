# Timzee Tech Hub — Production release gates

**Release candidate:** GitHub PR #7 (existing branch, no new branch)
**Deployment target:** Netlify production + Supabase
**Security rule:** A successful static build is necessary but never sufficient to merge a messaging/privacy release.

## Architecture and current safeguards

- Messages use server UTC timestamps and server-authoritative 15-minute edit eligibility.
- Sender-only edits, unsend, message pins, per-recipient receipt privacy, and membership checks are enforced in Supabase.
- Story statuses use server-time publishing with 24-hour standard and up-to-72-hour verified entitlements.
- Public status media is in the public `media` bucket; **friends-only** statuses and attached audio are in private `story-private-media` storage. Authorised owner/friends request a short-lived five-minute signed URL through `story-private-media`.
- Status music is currently **creator-supplied licensed audio**, played separately alongside the post. It is **not mixed into downloaded MP4s**, and there is no licensed commercial catalogue yet. Users must confirm their rights.
- Verified AI translation is opt-in. Groq receives requested message text, with an atomic 18-request-per-hour Supabase quota. No API secret is sent to the browser.
- Brevo delivery must remain explicitly opt-in through `EMAIL_DELIVERY_ENABLED=true`. The worker checks suppression, user email preferences, workflow status, a daily cap, and quarantines uncertain provider responses. The schedule is configured **only** in `netlify.toml` (every 15 minutes).
- The new smoke tests run during Netlify build with `npm run check`.

## Mandatory pre-merge checks

- [ ] Netlify checks pass on the exact **final PR head SHA**; compare the deployment commit to the PR head.
- [ ] Two signed-in users: direct and group messages send and receive; Edit appears only within 15 minutes, Edit saves and preserves unsent drafts, message info respects receipt settings, and video uploads report failures clearly.
- [ ] Private status: owner and accepted friend can view image, video, and soundtrack; signed-out, strangers, blocked users and expired status viewers **cannot**. Inspect network tab to ensure media comes from a short-lived `story-private-media` signed URL, not a public bucket URL.
- [ ] Standard account: publishing longer than 24 hours fails. Verified account: 48/72 hours accepted; changing phone clock cannot extend lifetime.
- [ ] On Android Chrome: status photo does not advance until loaded; video does not advance while buffering; long-press holds on centre or navigation sides; status audio pauses during hold; keyboard and controls remain inside viewport.
- [ ] Photo editing creates a new compressed file while preserving original; 10 MB audio limit and rights confirmation are enforced. Out-of-budget upload cleans temporary files, and status deletion removes owned media.
- [ ] Status/comment/post visibility and `@mention` notifications respect blocks and recipient privacy; no private media is accidentally forwarded or reshared publicly.
- [ ] Video comments can be switched off by creator, while the vote and reaction permissions are enforced server-side.
- [ ] Signed-in verified translation succeeds and preserves formatting. Standard account denied. Quota exhaustion returns a rate-limit response; requests never expose Groq key.
- [ ] Accessibility: keyboard and TalkBack can operate close, back, media controls, polls and privacy switches; screen reader labels reflect current state.
- [ ] Inspect Lighthouse / field metrics for slow mobile networks; media transcoding and resumable uploads require a separate processing pipeline for reliability at scale.

## Brevo activation sequence (blocked pending Netlify account permission)

1. In the Netlify production project's Environment Variables, confirm `BREVO_API_KEY`, `BREVO_SENDER_EMAIL`, `BREVO_SENDER_NAME` and Supabase service credentials exist, and verify sender/domain status with Brevo.
2. Keep `EMAIL_INACTIVITY_ENABLED` **off** until the separate inactivity workflow is reviewed and users' consent is confirmed.
3. Inspect queued jobs, suppressions and delivery statistics using the existing privileged `email-operations` admin workflow. Do not send stale queued emails.
4. Set `EMAIL_DELIVERY_ENABLED=true` **only after review**; trigger production deploy to apply environment change.
5. Run a single **user-authorized** test email and verify provider message ID, accepted state, bounce response and opt-out behaviour.
6. Monitor first 24 hours for duplicates, rejected sender domains and queue growth. Keep daily cap conservative.

**Current blocker:** Connected Netlify environment write permissions rejected attempts. Never bypass the flag in application code.

## Rollback

- UI regressions: redeploy the previously stable production Netlify deploy from the dashboard; do **not** revert database security policies simply to restore an old client.
- Brevo problems: immediately set `EMAIL_DELIVERY_ENABLED=false` and redeploy before investigating pending jobs. Quarantine ambiguous sends, don't retry blindly.
- Private-media signing incidents: disable the affected status UI while maintaining private bucket permissions; never switch `story-private-media` to public.
- Database migrations were applied independently of PR merge. Changes to an already deployed migration must be done with a **new** migration, not by deleting records or editing migration history.
- Retain server function errors and anonymous correlation IDs for post-incident analysis; avoid logging tokens, message bodies and recipient addresses.

## Planned next phase

Rights-cleared music catalogue provider contract; user-uploaded video transcoding and streaming ladder; resumable uploads and server-side media mixing; moderation/rate-limit observability; final per-surface verified benefit entitlement tests; infrastructure and storage lifecycle at larger scale.
