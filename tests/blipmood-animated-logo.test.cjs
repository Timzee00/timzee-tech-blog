const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=(p)=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");

test("animated logo preserves user-provided webp layers and defines one custom element",()=>{
 const logo=root("assets/js/blipmood-logo.js");
 assert.match(logo,/class BlipmoodLogo extends HTMLElement/);
 assert.match(logo,/customElements\.get\('blipmood-logo'\)/);
 assert.match(logo,/customElements\.define\('blipmood-logo', BlipmoodLogo\)/);
 assert.match(logo,/prefers-reduced-motion:reduce/);
 assert.match(logo,/theme/);
 assert.match(logo,/data:image\/webp;base64/);
 assert.ok(Buffer.byteLength(logo)>100_000,"embedded artwork was unexpectedly removed");
});

test("site shell loads animated logo after normal header and noncritical content",()=>{
 const shell=root("assets/js/site-shell.js");
 const module=root("assets/js/animated-brand.mjs");
 assert.match(shell,/ensureBlipmoodHeader\(\)/);
 assert.match(shell,/scheduleIdle\(\(\)=>/);
 assert.match(shell,/import\("\.\/animated-brand\.mjs"\)/);
 assert.match(module,/await import\("\.\/blipmood-logo\.js"\)/);
 assert.match(module,/\.site-header a\.brand > \.bm-brand-display/);
 assert.match(module,/img\.decode\(\)/);
 assert.match(module,/classList\.add\("bm-animated-ready"\)/);
 assert.match(module,/saveData/);
 assert.match(module,/prefers-reduced-motion: reduce/);
 assert.match(module,/aria-hidden/);
 assert.doesNotMatch(module,/replaceChildren/);
});

test("static brand remains accessible with responsive and reduced-motion fallbacks",()=>{
 const css=root("assets/css/blipmood-brand.css");
 const shell=root("assets/js/site-shell.js");
 const injection=root("scripts/inject-site-shell.mjs");
 assert.match(css,/\.bm-brand-display\.bm-animated-ready > \.bm-wordmark-image/);
 assert.match(css,/visibility:hidden/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/data-reduce-motion="true"/);
 assert.match(shell,/Blipmood — Home/);
 assert.match(injection,/BLIPMOOD_WORDMARK/);
 assert.match(injection,/bm-wordmark-image/);
});
