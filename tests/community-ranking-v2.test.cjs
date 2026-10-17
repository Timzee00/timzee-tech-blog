const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");
const root=join(__dirname,"..");
const read=p=>readFileSync(join(root,p),"utf8");
const helpers=import("../assets/js/community-feed-pagination.mjs");
const ID1="11111111-1111-4111-8111-111111111111";
const ID2="22222222-2222-4222-8222-222222222222";
const ID3="33333333-3333-4333-8333-333333333333";
test("ranked pagination extracts a strictly typed descending cursor",async()=>{
 const {communityRankCursor}=await helpers;
 assert.deepEqual(communityRankCursor({
  id:ID1,recommendation_score:"7.2315",created_at:"2026-10-17T11:00:00.000Z"
 }),{
  p_after_score:7.2315,p_after_created:"2026-10-17T11:00:00.000Z",p_after_id:ID1
 });
 assert.equal(communityRankCursor({id:"not-a-uuid",recommendation_score:4,created_at:new Date().toISOString()}),null);
 assert.equal(communityRankCursor({id:ID1,recommendation_score:"nan",created_at:new Date().toISOString()}),null);
 assert.equal(communityRankCursor(null),null);
});
test("cursor page merging is idempotent, does not mutate previous data and preserves ranking order",async()=>{
 const {appendUniqueCommunityRows}=await helpers;
 const previous=[{id:ID1,score:5},{id:ID2,score:3}];
 const incoming=[{id:ID2,score:3},{id:ID3,score:1},{id:ID3,score:0}];
 assert.deepEqual(appendUniqueCommunityRows(previous,incoming).map(row=>row.id),[ID1,ID2,ID3]);
 assert.equal(previous.length,2);
 assert.deepEqual(appendUniqueCommunityRows([],incoming).map(row=>row.id),[ID2,ID3]);
});
test("monotonic snapshot duration survives incorrect device wall-clock settings",async()=>{
 const {isCommunitySnapshotStale}=await helpers;
 const start=230000,now=start+60*60*1000;
 assert.equal(isCommunitySnapshotStale(start,now),false);
 assert.equal(isCommunitySnapshotStale(start,start+4*60*60*1000),true);
 assert.equal(isCommunitySnapshotStale(start,start-1),true);
 assert.equal(isCommunitySnapshotStale(Number.NaN,now),true);
});
test("new feed uses mixed bounded candidate sources with privacy and negative feedback",()=>{
 const migration=read("supabase/migrations/20261017030000_community_personal_feed_v2.sql");
 assert.match(migration,/community_personal_feed_v2/);
 assert.match(migration,/candidate_ids AS MATERIALIZED/);
 assert.match(migration,/ORDER BY t\.created_at DESC/);
 assert.match(migration,/ORDER BY t\.last_activity_at DESC/);
 assert.match(migration,/ORDER BY t\.score DESC/);
 assert.match(migration,/public\.community_can_read\(t\.community_id,cfg\.actor\)/);
 assert.match(migration,/community_feed_feedback/);
 assert.match(migration,/community_auto_moderation/);
 assert.match(migration,/author_position/);
 assert.match(migration,/community_position/);
 assert.match(migration,/p_after_score/);
 assert.match(migration,/LIMIT \(SELECT take FROM config\)/);
 assert.doesNotMatch(migration,/ORDER BY random\(\)/i);
});
test("community frontend uses server clock and keyset cursor, never offset pagination for personalized ranking",()=>{
 const client=read("assets/js/community-forum.mjs");
 const snapshot=read("supabase/migrations/20261017031000_community_feed_snapshot_clock.sql");
 assert.match(client,/supabase\.rpc\("community_feed_snapshot_clock"\)/);
 assert.match(client,/supabase\.rpc\("community_personal_feed_v2"/);
 assert.match(client,/communityRankCursor\(state\.feedCursor\)/);
 assert.match(client,/appendUniqueCommunityRows\(state\.feed,page\)/);
 assert.doesNotMatch(client,/supabase\.rpc\("community_personal_feed",/);
 assert.match(snapshot,/date_trunc\('minute',now\(\)\)/);
});
test("automated moderation provides explainable signals with reviewer control and protected RLS",()=>{
 const migration=read("supabase/migrations/20261017020000_auto_moderation_queue.sql");
 const client=read("assets/js/community-forum.mjs");
 assert.match(migration,/community_auto_mod_staff_read/);
 assert.match(migration,/community_review_auto_flag/);
 assert.match(migration,/excessive_links/);
 assert.match(migration,/possible_solicitation/);
 assert.match(migration,/community_auto_mod_signal/);
 assert.match(client,/loadAutoSignals/);
 assert.match(client,/reviewAutoSignal/);
 assert.doesNotMatch(migration,/DELETE FROM public\.community_threads/i);
});
