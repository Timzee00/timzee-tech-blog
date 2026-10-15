const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");
const ui=readFileSync(join(__dirname,"../assets/js/curator-ui.js"),"utf8");
const api=readFileSync(join(__dirname,"../netlify/functions/curator-expand-article.js"),"utf8");
test("draft image, credit, reporting and consent survive curator list refresh",()=>{
 for(const name of ["data-curator-images","data-curator-image-credit","data-curator-image-rights",
 "data-curator-reporting","data-curator-reporting-source","data-curator-reporting-checked"]){
  assert.ok(ui.includes(name),name+" missing");
 }
 assert.match(ui,/this\.captureCardDrafts\(\)/);
 assert.match(ui,/this\.restoreCardDrafts\(\)/);
 assert.match(ui,/this\.cardDrafts = new Map\(\)/);
});
test("editor can select an allowlisted server-side AI provider without exposing keys",()=>{
 assert.match(ui,/data-curator-provider=/);
 assert.match(api,/\["auto","groq","openrouter"\]/);
 assert.match(api,/Unsupported editorial AI provider/);
 assert.doesNotMatch(ui,/process\.env\.GROQ_API_KEY/);
});
