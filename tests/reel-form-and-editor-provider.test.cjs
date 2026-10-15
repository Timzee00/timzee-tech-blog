const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");
const video=readFileSync(join(__dirname,"../video.html"),"utf8");
const curator=readFileSync(join(__dirname,"../netlify/functions/curator-expand-article.js"),"utf8");
test("video comment errors are shown without falsely claiming success",()=>{
 assert.match(video,/if\(!result \|\| result\.error\)/);
 assert.match(video,/Could not post comment/);
 assert.match(video,/if\(submit\)submit\.disabled=true/);
 assert.match(video,/finally \{if\(submit\)submit\.disabled=false;\}/);
});
test("comment count failures remain optional after successful insert",()=>{
 assert.match(video,/Optional video comment count refresh failed/);
 assert.match(video,/if\(!counters\.error\)/);
});
test("explicit editor provider never silently falls back to another provider",()=>{
 assert.match(curator,/choice==="auto" && requested==="groq"/);
 assert.match(curator,/Unsupported editorial AI provider/);
});
