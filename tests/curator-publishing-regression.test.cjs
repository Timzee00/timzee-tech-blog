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

test("source image suggestions are included in the approval list used by preview and publish",()=>{
 const ui=fs.readFileSync(path.join(__dirname,"../assets/js/curator-ui.js"),"utf8");
 assert.match(ui,/embeddedCandidates[\s\S]*post\.image_url && trustedExternalUrl\(post\.image_url\) \? \[post\.image_url\] : \[\]/);
 assert.match(ui,/Approved image URLs<textarea[\s\S]*candidates\.join\("\\n"\)/);
 assert.match(ui,/const media=selected;/);
 assert.match(ui,/selectedImages\[0\] \|\| ""/);
 assert.match(ui,/placeEditorialFigures\(stripEditorialScaffolding\(body\),selectedImages,imageCredit\)/);
 assert.match(ui,/selectedImages\.length && \(!approved \|\| imageCredit\.length<5\)/);
});

test("published gallery repair starts with the saved source image but still requires rights confirmation",()=>{
 const ui=fs.readFileSync(path.join(__dirname,"../assets/js/curator-ui.js"),"utf8");
 assert.match(ui,/data-repair-images="\$\{post\.id\}"[^>]*>\$\{escapeHTML\(post\.image_url && trustedExternalUrl\(post\.image_url\) \? post\.image_url : ""\)\}/);
 assert.match(ui,/data-repair-rights="\$\{post\.id\}"/);
 assert.match(ui,/data-repair-credit="\$\{post\.id\}"/);
 assert.match(ui,/if\(!urls\.length\|\|!rights\|\|credit\.length<5\)/);
});
