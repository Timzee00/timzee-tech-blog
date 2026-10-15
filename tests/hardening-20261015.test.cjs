const test = require("node:test");
const assert = require("node:assert/strict");
const {rankScoutItems} = require("../netlify/functions/_lib/scout-ranking.cjs");
test("GDELT compact UTC publication dates stay eligible for trending",()=>{
  const now=Date.parse("2026-10-15T18:00:00Z");
  const raw=[{title:"New cybersecurity patch released for major platform",link:"https://example.test/story",published_at:"20261015T163000Z",summary:"Vendor statement with technical details about the patch."}];
  const ranked=rankScoutItems(raw,{now});
  assert.equal(ranked.length,1);
  assert.equal(ranked[0].link,raw[0].link);
});
test("Malformed or missing dates never masquerade as fresh news",()=>{
  const now=Date.parse("2026-10-15T18:00:00Z");
  const stories=[{title:"News without source timestamp",link:"https://example.test/undated"},{title:"Invalid GDELT month",link:"https://example.test/invalid",published_at:"20261315T090000Z"}];
  assert.equal(rankScoutItems(stories,{now}).length,0);
});
