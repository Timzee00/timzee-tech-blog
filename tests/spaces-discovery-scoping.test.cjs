const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const source=fs.readFileSync("assets/js/live-spaces.mjs","utf8");
test("live/upcoming tabs scope queries before fetching bounded rows",()=>{
 assert.match(source,/if\(tab==="live"\)/);
 assert.match(source,/query=query\.eq\("status","live"\)/);
 assert.match(source,/\.gte\("starts_at",new Date\(now-60\*60000\)/);
 assert.match(source,/query=query\.eq\("status","scheduled"\)/);
 assert.match(source,/\.gte\("starts_at",new Date\(now-5\*60000\)/);
 assert.match(source,/query\.order\("starts_at",\{ascending:false\}\)\.limit\(50\)/);
});
test("mine and cross-feature spaces are filtered in DB and stale requests discarded",()=>{
 assert.match(source,/query=query\.eq\("owner_id",state\.user\.id\)/);
 assert.match(source,/\["community","community_id"\]/);
 assert.match(source,/\["post","post_id"\]/);
 assert.match(source,/\["workspace","workspace_id"\]/);
 assert.match(source,/if\(requestId!==state\.roomsRequestId\)return/);
 assert.match(source,/void loadRooms\(\)/);
 assert.match(source,/roomExpired\(r\)\?"TIME ENDED"/);
});
