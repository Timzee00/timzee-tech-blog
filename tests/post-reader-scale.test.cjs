const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");
function file(name){return readFileSync(join(__dirname,"..",name),"utf8");}
test("article reader uses bounded related posts and like-count query",()=>{
 const reader=file("assets/js/post.js");
 const api=file("assets/js/data.js");
 assert.match(reader,/fetchRelatedPosts\(post,\{limit:4\}\)/);
 assert.match(reader,/fetchPostLikeSummary\(post\.id,state\.user\?\.id\)/);
 assert.doesNotMatch(reader,/fetchPosts\(\{ status: "published" \}\)/);
 assert.match(api,/head:true,count:"exact"/);
 assert.match(api,/\\.limit\(Math\\.max\(1,Math\\.min\(8/);
});
test("post comments load recent page and earlier pages on demand",()=>{
 const reader=file("assets/js/post.js");
 const api=file("assets/js/data.js");
 const html=file("post.html");
 assert.match(html,/id="loadOlderCommentsBtn"/);
 assert.match(reader,/fetchRecentPostComments\(post\.id,\{limit:40\}\)/);
 assert.match(reader,/fetchRecentPostComments\(postId,\{offset,limit:pageSize\}\)/);
 assert.match(api,/\\.range\(start,start\+size-1\)/);
});
