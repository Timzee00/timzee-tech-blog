const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {scheduleScoutSources,scoutSourceFlags,isUsableScoutFeedUrl}=require("../netlify/functions/_lib/scout-budget.cjs");
const {topicFor}=require("../netlify/functions/_lib/scout-ranking.cjs");
const source=(id,tags=[],date="2026-10-01T00:00:00Z")=>({
 id,enabled:true,feed_url:"https://news.example.edu/rss/"+id,tags,last_fetched_at:date
});
test("Nigeria news, sports and international reporting receive collection slots",()=>{
 const rows=[
  source("g1",[],"2026-09-01T00:00:00Z"),
  source("g2",[],"2026-09-02T00:00:00Z"),
  source("g3",[],"2026-09-03T00:00:00Z"),
  source("g4",[],"2026-09-04T00:00:00Z"),
  source("ngnews",["nigeria"],"2026-10-01T00:00:00Z"),
  source("ngsports",["nigeria","sports"],"2026-10-02T00:00:00Z"),
  source("sports",["sports"],"2026-10-03T00:00:00Z")
 ];
 const selected=scheduleScoutSources(rows);
 assert.deepEqual(selected.map(s=>s.id),["ngnews","ngsports","g1","g2"]);
 for(const item of selected)item.last_fetched_at="2026-10-24T09:00:00Z";
 assert.deepEqual(scheduleScoutSources(rows).map(s=>s.id),["ngnews","sports","g3","g4"]);
});
test("missing lanes keep oldest-first behavior and disabled feeds stay excluded",()=>{
 const rows=[source("a"),source("b"),source("c"),source("d"),source("e")];
 assert.deepEqual(scheduleScoutSources(rows).map(s=>s.id),["a","b","c","d"]);
 assert.deepEqual(scheduleScoutSources([...rows,{...source("x",["nigeria"]),enabled:false}]).map(s=>s.id),["a","b","c","d"]);
 assert.deepEqual(scoutSourceFlags({category:"sports",tags:["nigeria"]}),{local:true,sport:true});
});
test("reject placeholders and local addresses from env-configured feeds",()=>{
 for(const url of ["https://site1.com/rss","https://site2.com/feed",
  "https://site3.com/tips.rss","http://news.site.edu/feed",
  "https://localhost/feed","https://127.0.0.1/rss","file:///etc/passwd",
  "https://example.org/feed"]){
  assert.equal(isUsableScoutFeedUrl(url),false,url);
 }
 assert.equal(isUsableScoutFeedUrl("https://rss.punchng.com/v1/category/sports"),true);
 assert.equal(isUsableScoutFeedUrl("https://www.premiumtimesng.com/feed"),true);
});
test("sports classification respects football teams and other sports",()=>{
 assert.equal(topicFor({title:"NPFL Rangers secure a late win",source_tags:["nigeria","sports"]}),"football");
 assert.equal(topicFor({title:"D'Tigress win basketball event",source_tags:["nigeria","sports"]}),"sports");
 assert.equal(topicFor({title:"Super Falcons qualify for WAFCON",source_tags:["nigeria","sports"]}),"football");
 assert.equal(topicFor({title:"Nigeria's table tennis champions",source_tags:["nigeria","sports"]}),"sports");
});
test("Scout reads a broad source shortlist but still caps network fetches",()=>{
 const code=fs.readFileSync("netlify/functions/scout-news.js","utf8");
 assert.match(code,/\.limit\(64\)/);
 assert.match(code,/filter\(isUsableScoutFeedUrl\)/);
 assert.match(code,/ignoreDuplicates: true/);
 assert.match(code,/source_tags: source\.tags/);
});
