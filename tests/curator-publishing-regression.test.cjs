const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
test("curator code preserves published post mapping for gallery repair",()=>{
 const a=fs.readFileSync(path.join(__dirname,"../assets/js/curator.js"),"utf8");
 const ui=fs.readFileSync(path.join(__dirname,"../assets/js/curator-ui.js"),"utf8");
 assert.match(a,/post_id:\s*publishedPostId/);
 assert.match(ui,/attachMissingGallery/);
 assert.match(ui,/getPublishedCuratorPosts/);
 assert.match(ui,/suggestRoundupIds/);
});
test("gallery editor requires rights before saving media",()=>{
 const ui=fs.readFileSync(path.join(__dirname,"../assets/js/curator-ui.js"),"utf8");
 assert.match(ui,/selectedImages\.length && \(!approved \|\| imageCredit\.length<5\)/);
 assert.match(ui,/data-repair-rights/);
});
