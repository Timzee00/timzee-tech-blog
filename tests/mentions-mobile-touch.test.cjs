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

test("no-result suggestion list must not swallow Enter or caret keys",()=>{
 const idx=code.indexOf('if (activeMentionDropdown && event.key === "Enter")');
 assert.ok(idx>=0);
 const branch=code.slice(idx,idx+800);
 assert.match(branch,/if \(!target\) return;\s*event\.preventDefault\(\);/);
 const arrow=code.slice(code.indexOf('event.key === "ArrowDown"'),code.indexOf('// Handle Enter to select mention'));
 assert.match(arrow,/if \(items\.length === 0\) return;\s*event\.preventDefault\(\);/);
});
