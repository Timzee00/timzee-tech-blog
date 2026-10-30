const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=file=>fs.readFileSync(path.join(__dirname,"..",file),"utf8");

test("intro is Blipmood-branded and uses its actual logo assets",()=>{
 const source=read("assets/js/blipmood-intro.mjs");
 assert.match(source,/Welcome to Blipmood/);
 assert.match(source,/blipmood-wordmark-dark[.]png/);
 assert.match(source,/blipmood-emblem-dark[.]png/);
 assert.match(source,/import\("\.\/blipmood-logo[.]js"\)/);
 assert.doesNotMatch(source,/TIMZEE TECH HUB|timzeeTechHubIntroSeen/);
 assert.match(source,/DISCUSS/);
 assert.match(source,/REELS/);
 assert.match(source,/MARKET/);
});

test("intro respects returning visitors, accessibility, data saving and manual replay",()=>{
 const source=read("assets/js/blipmood-intro.mjs");
 const shell=read("assets/js/site-shell.js");
 const css=read("assets/css/blipmood-intro.css");
 assert.match(source,/localStorage[.]getItem\(KEY\)/);
 assert.match(source,/localStorage[.]setItem\(KEY,"1"\)/);
 assert.match(source,/currentIsHome\(\)/);
 assert.match(source,/prefers-reduced-motion: reduce/);
 assert.match(source,/saveData/);
 assert.match(source,/querySelector\("#bmci-skip"\)/);
 assert.match(source,/e[.]key==="Escape"/);
 assert.match(source,/e[.]key==="Tab"/);
 assert.match(source,/document[.]body[.]style[.]overflow=previousOverflow/);
 assert.match(source,/export async function playIntro\(\{force=false\}/);
 assert.match(shell,/Replay intro/);
 assert.match(shell,/playIntro\(\{force:true\}\)/);
 assert.match(css,/max-width:540px/);
 assert.match(css,/max-height:460px/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});

test("home page launches intro only once and prevents the legacy welcome popup stacking",()=>{
 const shell=read("assets/js/site-shell.js");
 const pos=shell.indexOf('if(currentSitePath()==="index.html"){');
 assert.ok(pos>=0);
 const block=shell.slice(pos);
 assert.match(block,/let introPlanned=false/);
 assert.match(block,/import\("\.\/blipmood-intro[.]mjs"\)/);
 assert.match(block,/if\(introPlanned\)/);
 assert.match(block,/\}\s*else\s*\{\s*\/\/ The site already has a guest welcome campaign/);
 assert.match(block,/import\("\.\/blipmood-welcome[.]mjs"\)/);
 assert.doesNotMatch(shell,/^import "\.\/blipmood-intro[.]mjs";/m);
});

test("intro styles are scoped, keyboard focusable and do not mutate the global page palette",()=>{
 const css=read("assets/css/blipmood-intro.css");
 assert.match(css,/#bm-cinema-intro[ ]*\{/);
 assert.match(css,/#bm-cinema-intro .bmci-skip:focus-visible/);
 assert.doesNotMatch(css,/(?:^|\n):root[ ]*\{/);
 assert.doesNotMatch(css,/(?:^|\n)body[ ]*\{/);
 assert.match(css,/z-index:100200/);
});
