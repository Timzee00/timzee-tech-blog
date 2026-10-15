const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");
const code=readFileSync(join(__dirname,"../assets/js/mentions.js"),"utf8");
test("touch mention selection happens on pointerdown before blur timeout",()=>{
  assert.match(code,/item\.addEventListener\("pointerdown",event=>\{/);
  assert.match(code,/event\.preventDefault\(\);\s*choose\(\);/);
  assert.match(code,/item\.addEventListener\("click",choose\)/);
  assert.match(code,/let chosen=false;/);
});
test("suggestion listbox synchronizes accessible expansion and closes cleanly",()=>{
  assert.match(code,/dropdown\.id = "timzee-mention-suggestions"/);
  assert.match(code,/field\.setAttribute\("aria-controls",dropdown\.id\)/);
  assert.match(code,/activeMentionField\.setAttribute\("aria-expanded","false"\)/);
  assert.match(code,/field\.setAttribute\("aria-haspopup","listbox"\)/);
});
