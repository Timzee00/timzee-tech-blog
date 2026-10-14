const test=require("node:test");
const assert=require("node:assert/strict");
const {newsScore,rankScoutItems,topicFor}=require("../netlify/functions/_lib/scout-ranking.cjs");
const now=Date.parse("2026-10-14T12:00:00Z");
test("fresh indie builder stories outrank old generic items",()=>{
 const fresh={title:"Independent developer launched an open-source app",link:"https://example.org/a",published_at:"2026-10-14T09:00:00Z",summary:"Detailed release notes describing an actual source-backed developer project."};
 const stale={title:"An old technology article",link:"https://example.org/b",published_at:"2026-10-01T09:00:00Z",summary:"Old news"};
 assert.ok(newsScore(fresh,now)>newsScore(stale,now));
 assert.deepEqual(rankScoutItems([stale,fresh],{now}).map(x=>x.link),[fresh.link]);
 assert.equal(topicFor(fresh),"builders");
});
test("duplicates, future dates and stories older than seven days are excluded",()=>{
 const a={title:"New startup AI model released",link:"https://example.org/a",published_at:"2026-10-14T11:00:00Z"};
 const b={...a,link:"https://example.org/b"};
 const future={...a,title:"Future",published_at:"2026-10-18T11:00:00Z"};
 assert.equal(rankScoutItems([a,b,future],{now}).length,1);
});
test("topic diversity prevents a source from filling every position with AI",()=>{
 const items=Array.from({length:9},(_,i)=>({title:"AI model release "+i,link:"https://example.org/"+i,published_at:"2026-10-14T10:00:00Z"}));
 items.push({title:"Database framework released",link:"https://example.org/db",published_at:"2026-10-14T08:00:00Z"});
 const result=rankScoutItems(items,{now,maxPerTopic:2});
 assert.equal(result.filter(v=>topicFor(v)==="ai").length,2);
 assert.ok(result.some(v=>topicFor(v)==="software"));
});
