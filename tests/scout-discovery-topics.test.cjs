const test=require("node:test");
const assert=require("node:assert/strict");
const {topicFor,rankScoutItems}=require("../netlify/functions/_lib/scout-ranking.cjs");
const now=Date.parse("2026-10-14T12:00:00Z");
test("classifies job roundups, football and entertainment separately",()=>{
 assert.equal(topicFor({title:"Five remote job openings for graduates in Lagos"}),"jobs");
 assert.equal(topicFor({title:"Champions League football transfer update"}),"football");
 assert.equal(topicFor({title:"Afrobeats artist announces album"}),"music");
 assert.equal(topicFor({title:"Scholarship applications open for students"}),"scholarships");
});
test("30-day opportunity horizon differs from seven-day breaking-news window",()=>{
 const published_at="2026-09-30T09:00:00Z";
 const a={title:"Scholarship applications open for students",link:"https://example.org/a",published_at};
 const b={title:"Football transfer season news",link:"https://example.org/b",published_at};
 const rows=rankScoutItems([a,b],{now});
 assert.equal(rows.length,1);
 assert.equal(rows[0].link,a.link);
});
