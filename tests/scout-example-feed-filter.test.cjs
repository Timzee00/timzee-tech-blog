const test=require("node:test"),assert=require("node:assert/strict");
const {pathToFileURL}=require("node:url"),path=require("node:path");
const server=require("../netlify/functions/_lib/scout-budget.cjs");
test("placeholder feeds never consume Scout's hourly budget",()=>{
 const rows=[{id:"1",enabled:true,feed_url:"https://site1.com/rss"},
 {id:"2",enabled:true,feed_url:"https://site2.com/feed"},
 {id:"3",enabled:true,feed_url:"https://site3.com/tips.rss"},
 {id:"4",enabled:true,feed_url:"https://github.blog/feed/"}];
 assert.deepEqual(server.scheduleScoutSources(rows).map(x=>x.id),["4"]);
});
test("browser and Scout agree on example hosts",async()=>{
 const frontend=await import(pathToFileURL(path.resolve(__dirname,"../assets/js/scout-source-health.mjs")).href);
 for(const url of ["https://site1.com/rss","https://site2.com/feed",
  "https://site3.com/tips.rss","https://example.org/feed",
  "https://github.blog/feed/","https://www.bbc.com/news/"]){
  assert.equal(frontend.isDemoFeedUrl(url),server.isDemoFeedUrl(url),url);
 }
 assert.equal(server.isDemoFeedUrl("https://github.blog/feed/"),false);
});
