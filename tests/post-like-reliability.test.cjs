const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const path=require("node:path");
const load=p=>readFileSync(path.join(__dirname,"..",p),"utf8");
test("like operation returns actual database errors rather than silently toggling",()=>{
 const api=load("assets/js/data.js"),reader=load("assets/js/post.js");
 assert.match(api,/return \{ liked: false, error: existing\.error \}/);
 assert.match(api,/return \{ liked: true, error: removed\.error \}/);
 assert.match(api,/return \{ liked: false, error: inserted\.error \}/);
 assert.match(reader,/if\(result\.error\)throw result\.error/);
 assert.match(reader,/busy=true;likeBtn\.disabled=true/);
});
test("article body remains visible during ancillary request errors",()=>{
 const reader=load("assets/js/post.js");
 assert.match(reader,/fetchRecentPostComments\(post\.id,\{limit:40\}\)\.catch/);
 assert.match(reader,/fetchPostLikeSummary\(post\.id,state\.user\?\.id\)\.catch/);
});
