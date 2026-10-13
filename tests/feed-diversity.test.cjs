const test = require("node:test");
const assert = require("node:assert/strict");
const rows = [
  ...Array.from({length: 8},(_,i)=>({ content_type:"post", content_id:"p"+i, author_id:"a", score:100-i })),
  ...Array.from({length: 5},(_,i)=>({ content_type:"video", content_id:"v"+i, author_id:"v"+i, score:80-i })),
  ...Array.from({length: 3},(_,i)=>({ content_type:"discussion", content_id:"d"+i, author_id:"d"+i, score:60-i }))
];
test("diversifies first viewport without discarding ranked candidates", async () => {
  const { diversifyFeed } = await import("../assets/js/feed-diversity.mjs");
  const ordered = diversifyFeed([...rows,rows[0]]);
  assert.equal(ordered.length, rows.length);
  assert.ok(ordered.slice(0,12).filter(r=>r.author_id==="a").length<=2);
  assert.ok(ordered.slice(0,12).filter(r=>r.content_type==="post").length<=6);
  assert.deepEqual(diversifyFeed(rows,{mode:"following"}),rows);
});
test("bounded memory cache respects TTL and mode boundaries", async () => {
  const { feedCacheKey, cachedFeed } = await import("../assets/js/feed-diversity.mjs");
  const cache = new Map([[feedCacheKey("for-you","all"), {time:100, rows}]]);
  assert.equal(cachedFeed(cache,"for-you:all",200),rows);
  assert.equal(cachedFeed(cache,"for-you:all",50000),null);
  assert.equal(cachedFeed(cache,"following:all",200),null);
});
test("feed utility deduplicates and rejects unknown content types", async () => {
  const {diversifyFeed}=await import("../assets/js/feed-diversity.mjs");
  assert.deepEqual(diversifyFeed([{content_type:"post",content_id:"1"},{content_type:"post",content_id:"1"},{content_type:"unknown",content_id:"x"}]),[{content_type:"post",content_id:"1"}]);
});
