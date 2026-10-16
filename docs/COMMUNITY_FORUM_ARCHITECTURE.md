# Timzee Communities — Forum architecture and release checklist

**Scope:** Timzee Tech Hub Discussions → Nairaland-style topic boards + Reddit-style subreddit communities.

## User journeys

- **Guest:** Browse the community directory and topic threads, read replies, search titles, follow links; sign-in required to join, vote, report, save or post.
- **Member:** Join/leave communities, filter by subject, see joined-community feed, create topic threads, reply to a particular comment with `@mention` autocomplete, vote up/down, bookmark, attach photo or short video, report abuse.
- **Community owner:** Set board posting policy (everyone, members, moderators), moderate topics, review reports, ban members and appoint moderators.
- **Moderator / platform staff:** Pin, unpin, lock, unlock, remove threads and review reports; site administrators can staff system-created boards. Server enforces these actions with RPCs and row-level security.

## Data model

```
discussion_topics                 ← durable community boards (existing IDs kept)
 ├── community_members            ← member/owner/moderator roles
 ├── community_threads            ← topics within a board
 │    ├── discussion_messages      ← threaded replies, legacy messages retained
 │    ├── community_thread_votes   ← one up/down vote per user
 │    └── community_saved_threads  ← private bookmarks
 ├── community_reports            ← member abuse reports, role-secured triage
 └── community_legacy_redirects   ← ?topic=UUID → new ?thread=UUID
```

All forum tables have suitable indexes and RLS. Thread feeds load 20 items at a time with keyset cursors and indexed sorting; replies load 30 at a time. Thread title/body search uses a stored PostgreSQL full-text vector + GIN index. No full community message history is loaded on entry.

### Existing content preserved

The original 7 `discussion_topics` records were single-topic conversations. They remain in the database for legacy links, but are archived as boards. They now appear as seven normal topic threads inside fourteen evergreen communities:

- **Sports:** Ronaldo/Messi, Arsenal/FIFA.
- **Entertainment & Creators:** Peller/IShowSpeed, Solo Leveling.
- **World News & Affairs:** Russia/Ukraine.
- **Project Showcase & Feedback:** Website feedback and SwissKit.
- Other boards: AI, Programming, Tech News, Gadgets, Cybersecurity, Jobs, Gaming, Startups, Learning, General.

**Baseline validated after migration:** 14 active boards, 7 archived originals, 7 original threads, 21 preserved replies, 5 original topic media objects, 20 media replies, 7 legacy redirects, no missing reply-to-thread mappings.

The archived original source is kept intact; the public new frontend uses the reclassified thread ID. The previous discussion frontend remains in the repository for emergency rollback.

## Security boundaries

- The database, not the interface, enforces thread posting eligibility, membership restrictions, author identity, moderation status, locked topics, cross-thread reply references, and report review permissions.
- Authors cannot set a fake `author_name`, choose official announcement status without staff membership, or upload another user's forum media reference.
- New topic submissions are capped at 10/hour and replies at 12/minute for regular accounts. Reports are limited to 15/day per person.
- Users cannot promote themselves to moderator. The board owner or an authorized platform admin assigns moderators with the scoped RPC.
- A removed thread's replies are not publicly readable under the updated messages RLS.
- Only a user's own vote and saved state are visible via the corresponding RLS-protected tables.
- File uploads must be JPEG/PNG/WebP/GIF or MP4/WebM, up to 12 MB, using authenticated owner-scoped storage paths. Rejected submissions attempt to delete the temporary upload.
- A report does not automatically remove content; moderators review it, reducing malicious mass-report takedowns.
- Mentions and reply notifications continue to be issued by server triggers, now deep-linking to the exact `?thread=UUID`.

## Production checklist (release blocked by paused Netlify project)

- [x] Run safe non-destructive schema migrations against Supabase.
- [x] Preserve 7 old topics, 21 replies, media and original links.
- [x] GitHub code for the new discussion shell, module, responsive CSS, and moderator/report dialogs.
- [x] Static source and migration regression tests included in `npm run check`.
- [ ] Run the exact current PR-head build when Netlify credits/project access is restored.
- [ ] Verify Android Chrome and small-screen TalkBack: category navigation, scroll, thread deep links, modal editor, and media playback.
- [ ] Two accounts: join/leave, restrict members-only boards, post/reply, reply-to, and mentions with correct notifications.
- [ ] Staff account: moderator promotion, ban member, pin/lock/remove thread, review reports; anonymous clients must be denied.
- [ ] Load test large communities: indexed feed pagination, search latency, concurrent reply counters, and rate limits.
- [ ] Verify old `?topic=UUID` links redirect to the matching migrated thread.
- [ ] Confirm production monitoring, error logging, content policy, and consent text before opening onboarding to larger audiences.
- [ ] Merge PR after final checks. The main production site is still unchanged.

## Known limitations, deliberate follow-ups

- Currently no video transcoding, streaming ladder, or resumable multi-GB uploads. Short files with lazy loading are appropriate to this release and free-tier limits.
- Multiple images per post, nested Reddit-like voting on each individual comment, private communities, user-created topic flairs, richer Markdown editor, and native community polls remain future upgrades; do not advertise these as implemented.
- Per-thread OpenGraph previews need SSR/Edge or dynamic rendering once hosting is restored.
- Ownerless, system-created community boards are moderated by platform admins, who can appoint a moderator from existing members. Do not assign fake ownership to deleted legacy accounts.
- Users with more than 200 joined/saved communities need a dedicated keyset membership feed RPC rather than current bounded client-side ID retrieval.
- Discussion traffic does not need full realtime websocket fan-out to every thread. Users can refresh replies explicitly, reducing cost and noise.

## Rollback

If frontend regressions occur, restore the previous `discussion.html` script from Git history without reverting security policy migrations. Keep `community_legacy_redirects` and archived source records. Never delete or overwrite `discussion_messages` as part of rollback. Migration changes after deployment must always use new forward migrations.
