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

test("normalizes compact GDELT dates and rejects malformed input safely", () => {
  const { normalizeScoutDate } = require("../netlify/functions/_lib/scout-budget.cjs");
  assert.equal(normalizeScoutDate("20261013T183000Z"),"2026-10-13T18:30:00.000Z");
  assert.equal(normalizeScoutDate("invalid",new Date("2026-01-01T00:00:00Z")),"2026-01-01T00:00:00.000Z");
});
test("accepts only HTTP(S) article links and strips fragments", () => {
  const { normalizeScoutArticleUrl } = require("../netlify/functions/_lib/scout-budget.cjs");
  assert.equal(normalizeScoutArticleUrl("https://example.com/article#section"),"https://example.com/article");
  assert.equal(normalizeScoutArticleUrl("javascript:alert(1)"),"");
  assert.equal(normalizeScoutArticleUrl("file:///etc/passwd"),"");
});


test("actually excludes old articles before ranking and draft import",()=>{
  const {isStaleScoutItem}=require("../netlify/functions/_lib/scout-budget.cjs");
  const now=Date.parse("2026-10-23T12:00:00Z");
  assert.equal(isStaleScoutItem({published_at:"2026-10-01T12:00:00Z"},{now,maxAgeDays:7}),true);
  assert.equal(isStaleScoutItem({published_at:"2026-10-20T12:00:00Z"},{now,maxAgeDays:7}),false);
  assert.equal(isStaleScoutItem({published_at:"2026-10-01T12:00:00Z"},{now,maxAgeDays:30}),false);
  assert.equal(isStaleScoutItem({published_at:"20261001T120000Z"},{now,maxAgeDays:7}),true);
  assert.equal(isStaleScoutItem({published_at:"not-a-date"},{now,maxAgeDays:7}),false);
  assert.equal(isStaleScoutItem({published_at:null},{now,maxAgeDays:7}),false);
  const scout= require("node:fs").readFileSync("netlify/functions/scout-news.js","utf8");
  assert.match(scout,/if\(isStaleScoutItem\(item,\{maxAgeDays\}\)\)\{staleItemsSkipped\+\+;continue;\}/);
  assert.match(scout,/rankScoutItems\(eligible,/);
  assert.doesNotMatch(scout,/stale_items_skipped: filteredStale/);
});
