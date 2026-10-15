const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const src=fs.readFileSync(require("node:path").join(__dirname,"../assets/js/post.js"),"utf8");
test("an optional failing article widget cannot erase rendered post body",()=>{
 assert.match(src,/let articleRendered=false/);
 assert.match(src,/articleRendered=true/);
 assert.match(src,/if\(articleRendered\)\{/);
 assert.match(src,/data-enhancement-error/);
});
