const test=require("node:test");
const assert=require("node:assert/strict");
const helpers=import("../assets/js/curator-publishing.mjs");

test("approved images can be assigned to the appropriate article sections",async()=>{
  const {parseEditorialImageRows,placeEditorialFigures}=await helpers;
  const rows=parseEditorialImageRows([
    "https://example.com/cover.jpg",
    "https://example.com/limitation.jpg | Limitations | Screenshot of the limitation",
    "https://example.com/diagram.jpg | What happened | Verified diagram"
  ].join("\n"));
  assert.equal(rows.length,3);
  const html="<h2>What happened</h2><p>Report</p><h2>Limitations</h2><p>Risk</p>";
  const output=placeEditorialFigures(html,rows,"Permission granted");
  assert.equal((output.match(/<figure/g)||[]).length,2);
  const headingIndex=output.indexOf("<h2>Limitations");
  assert.ok(output.indexOf("limitation.jpg")>headingIndex);
  assert.ok(output.indexOf("Verified diagram")>output.indexOf("<h2>What happened"));
  assert.ok(output.includes("Screenshot of the limitation"));
});
test("URL validation rejects unsafe entries and duplicate photos",async()=>{
  const {parseEditorialImageRows}=await helpers;
  const rows=parseEditorialImageRows("javascript:alert(1)\nhttps://example.com/x.jpg\nhttps://example.com/x.jpg\nhttp://127.0.0.1/private");
  assert.equal(rows.length,1);
  assert.equal(rows[0].url,"https://example.com/x.jpg");
});
test("legacy one-link-per-line entry remains compatible",async()=>{
  const {parseEditorialImageRows,placeEditorialFigures}=await helpers;
  const rows=parseEditorialImageRows("https://example.com/cover.jpg\nhttps://example.com/inline.jpg");
  assert.equal(rows[1].heading,"");
  const out=placeEditorialFigures("<h2>Context</h2><p>Body</p>",rows,"Verified permission");
  assert.ok(out.includes("inline.jpg"));
});

test("figures appear after their relevant paragraph, not before the explanation",async()=>{
  const {placeEditorialFigures,parseEditorialImageRows}=await helpers;
  const rows=parseEditorialImageRows(
    "https://example.com/cover.png\nhttps://example.com/checklist.png | Eligibility | Official requirements image"
  );
  const body="<h2>Eligibility</h2><p>Applicants must review official conditions.</p><h2>Next steps</h2><p>Check deadlines.</p>";
  const html=placeEditorialFigures(body,rows,"Rights verified");
  assert.ok(html.indexOf("checklist.png")>html.indexOf("</p>"));
  assert.ok(html.indexOf("checklist.png")<html.indexOf("<h2>Next steps</h2>"));
});
test("multiple figures assigned to one section retain editor-supplied order",async()=>{
 const {placeEditorialFigures,parseEditorialImageRows}=await helpers;
 const rows=parseEditorialImageRows([
  "https://example.com/cover.png",
  "https://example.com/one.png | Findings | First illustration",
  "https://example.com/two.png | Findings | Second illustration"
 ].join("\n"));
 const result=placeEditorialFigures("<h2>Findings</h2><p>Details.</p>",rows,"Approved");
 assert.ok(result.indexOf("one.png")<result.indexOf("two.png"));
});
