const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
const load=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
test("article loads publicly before auth/settings and suppresses generic placeholders",()=>{
 const html=load("post.html"),code=load("assets/js/post.js");
 assert.match(html,/Loading article…/);
 assert.match(html,/aria-busy="true"/);
 const early=code.indexOf("renderPost({categories:[]},post)");
 const auth=code.indexOf("const [user,siteSettings]=await Promise.all");
 assert.ok(early>0 && auth>early);
});
test("pagination preserves author data from earlier loaded pages",()=>{
 const code=load("assets/js/post.js");
 assert.match(code,/const map = \{\.\.\.state\.commentAuthors\}/);
 assert.match(code,/const missing=ids\.filter/);
});
