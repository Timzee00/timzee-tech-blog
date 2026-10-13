const test = require("node:test");
const assert = require("node:assert/strict");
const { clampScoutItems, scheduleScoutSources, SCOUT_LIMITS } = require("../netlify/functions/_lib/scout-budget.cjs");
test("a scheduled news run is bounded even if settings are extreme", () => {
  assert.equal(clampScoutItems(999999),6);
  assert.equal(clampScoutItems(-9),1);
  assert.equal(clampScoutItems("nope"),5);
  assert.equal(SCOUT_LIMITS.MAX_SOURCES,4);
});
test("oldest source is served first and disabled/malformed rows are excluded", () => {
  const sources=Array.from({length:12},(_,i)=>({id:"s"+i,enabled:true,feed_url:"https://example.org/rss/"+i,last_fetched_at:new Date(Date.UTC(2026,0,i+1)).toISOString()}));
  const result=scheduleScoutSources([...sources,{id:"s0",feed_url:"https://example.org/rss/0"}, {id:"disabled",enabled:false,feed_url:"https://example.org"}]);
  assert.equal(result.length,4);
  assert.deepEqual(result.map(s=>s.id),["s0","s1","s2","s3"]);
});
test("source rotation after successful fetch moves it behind older sources", () => {
  const rows=Array.from({length:8},(_,i)=>({id:"s"+i,feed_url:"https://example.org/"+i,last_fetched_at:null}));
  assert.deepEqual(scheduleScoutSources(rows).map(s=>s.id),["s0","s1","s2","s3"]);
  rows.slice(0,4).forEach(s=>s.last_fetched_at="2026-10-13T01:00:00Z");
  assert.deepEqual(scheduleScoutSources(rows).map(s=>s.id),["s4","s5","s6","s7"]);
});

test("source insert failure stays failed rather than resetting health", () => {
  const { classifyScoutSource } = require("../netlify/functions/_lib/scout-budget.cjs");
  assert.equal(classifyScoutSource({fetched:true,errors:["column missing"]}),"failed");
  assert.equal(classifyScoutSource({fetched:true,inserts:1,errors:["one rejected"]}),"partial");
  assert.equal(classifyScoutSource({fetched:true,duplicates:3}),"already_imported");
  assert.equal(classifyScoutSource({fetched:true}),"empty_feed");
  assert.equal(classifyScoutSource({fetched:false}),"failed");
});
