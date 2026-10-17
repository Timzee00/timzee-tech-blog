# Community Feed V2 — recommendation and safety operations

## Status (October 17, 2026)

The v2 ranking function, server clock, browser cursor integration, and moderation signal queue have been committed to the same development pull request. Supabase migrations were applied to the connected project. **This is not a production launch:** Netlify remains paused for exhausted credits, and authenticated device tests and load tests are pending.

## Principles

1. **Explicit interests first:** readers choose technology categories. Memberships add a relevance boost; no hidden watch-time profiling is required.
2. **Useful conversation:** reply counts and net voting matter, but signals are logarithmically capped at 50 to reduce gaming.
3. **Fresh but not disposable:** recently created and recently active threads both receive separate decaying boosts. A good ongoing discussion can compete with a new post.
4. **Candidate coverage:** the server retrieves bounded candidates from fresh, active, popular and joined-community pools instead of only the newest posts.
5. **Diversity:** after two entries from the same community or author, additional entries receive increasing penalties; they remain discoverable, not silently deleted.
6. **Reader control:** `Not interested` feedback filters that exact thread from personalized recommendations. Selected interests are available for editing and can be deleted.
7. **Explainability:** eligible entries carry one of `From a community you joined`, `Matches an interest you selected`, `Useful ongoing conversation`, `Appreciated by readers`, or `Discover a new conversation`.
8. **Privacy:** candidate ranking calls `community_can_read` with the authenticated actor; private/restricted posts are never recommended to an unauthorized viewer.
9. **Moderation:** only published topics in active boards qualify. The server excludes high-risk posts awaiting additional moderation review from the recommendation feed; reports themselves do not automatically delete posts.
10. **Predictable costs:** candidate pools have bounded sizes (250 fresh, 250 active, 150 popular, 150 joined; union deduplicates). Response pages are capped at 20 and use score/time/ID keyset cursors rather than deep OFFSET scans.

## Pagination

- `community_feed_snapshot_clock()` returns the database UTC minute and is requested **once when the feed resets**.
- `community_personal_feed_v2(p_limit, p_after_score, p_after_created, p_after_id, p_as_of)` orders by rounded weight, creation timestamp, and UUID.
- The client reuses the same `p_as_of` and the last returned row's score/time/ID as the next cursor.
- Client helpers validate cursor fields and remove duplicate IDs across pages. The 210-minute session expiry uses monotonic elapsed time (`performance.now()`), so an Android phone with an incorrect system clock will not immediately invalidate the feed.
- **Limit:** votes, membership and reply totals can change while browsing, which can change scores despite a frozen timestamp. Full cross-page snapshot consistency at larger scale requires materializing a short-lived ranked candidate session or an event-sourced score snapshot; this version primarily stabilizes *new content* arrival and reduces offset-related drift.

## Moderation behavior

- Existing automatic moderator checks can mark content pending approval according to configured rules.
- Additional explainable spam signals flag link-heavy messages, possible solicitation, and excessive punctuation. These flags enter a **staff-only queue**; they do not constitute proof of abuse.
- Authorized moderators may mark a flag reviewed or a false positive, and use existing topic removal/report workflows separately.
- A request to review an automated flag is always checked server-side; ordinary users cannot list all flags or approve themselves.
- No secret content moderation model or external API is required, so this stage does not create recurring AI API charges.

## Validation completed

- The connected database accepted the v2 and snapshot-clock migrations.
- One direct query returned the existing seven eligible threads.
- A two-page SQL check (3 threads/page) found **zero repeated IDs**.
- A database-side EXPLAIN on the present tiny dataset completed in ~42 ms. This must **not** be extrapolated to traffic at scale.
- Test cases cover cursor validation, idempotent page merging, snapshot aging, SQL privacy constraints and moderation permissions.
- The development pull request source parses and has not been merged into `main`.

## Required production gates

- [ ] Run `npm run build` and all browser tests on the exact release commit once Netlify hosting resumes.
- [ ] Test with owner, ordinary member, banned member, private member and signed-out browsers. A nonmember must never receive a private board's title/body, gallery URL or personal feed entry.
- [ ] Populate synthetic staging communities (not live user data) with hundreds of authors and thousands of threads, and measure PostgreSQL p95/p99 and buffer hits under different concurrent request levels.
- [ ] Check repeated next-page clicks, navigating away during fetch, stale local/device time, and temporary connection loss.
- [ ] Validate that `Not interested` blocks the thread on refresh without unexpectedly affecting other communities.
- [ ] Audit ranking for creator dominance, low-quality voting rings, and the impact on small communities. Adjust weights against observed retention and quality metrics rather than encouraging excessive scrolling.
- [ ] Audit moderator alerts for false positives, legitimate security education, and non-English language; automation must remain reviewable.
- [ ] Add privacy-conscious aggregate measurements for weekly returning readers and feed usefulness, with deletion and consent behavior documented.
- [ ] Obtain live Netlify deploy confirmation and complete account-level acceptance testing before merging the PR.
 
## Rollback

The existing `community_personal_feed(integer,integer)` RPC remains intact for older clients. The UI can be reverted to the previous commit without undoing Supabase security policies. Keep `community_personal_feed_v2`, clock and indexes in place until all clients are migrated; avoid destructive migrations. Automated signals can be ignored or disabled with a forward migration; do not turn private buckets public to troubleshoot the feed.
