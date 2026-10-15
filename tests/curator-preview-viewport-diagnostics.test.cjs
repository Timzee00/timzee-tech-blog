const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");
const code=readFileSync(join(__dirname,"../assets/js/curator-ui.js"),"utf8");
test("preview follows visual viewport on Android keyboard and orientation changes",()=>{
 assert.match(code,/window\.visualViewport/);
 assert.match(code,/viewport\?\.addEventListener\("resize",fitPreview\)/);
 assert.match(code,/viewport\?\.removeEventListener\("resize",fitPreview\)/);
 assert.match(code,/dialog\.style\.height=Math\.max\(0,Math\.min\(900,height-16\)\)/);
});
test("per-draft editorial errors persist as accessible status text",()=>{
 assert.match(code,/note\.textContent="Expansion failed: "\+message/);
 assert.match(code,/note\.textContent="Translation failed: "\+message/);
 assert.match(code,/note\.setAttribute\("role","alert"\)/);
});
