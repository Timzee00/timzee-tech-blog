const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {resolve}=require("node:path");
const read=path=>readFileSync(resolve(__dirname,"..",path),"utf8");
test("approved Blipmood PNGs are integrity pinned and bundled as first-party assets",async()=>{
 const {BRAND_ASSETS,useLocalBrandAssetUrls}=await import("../scripts/brand-assets.mjs");
 const build=read("scripts/build-site.mjs");
 assert.equal(BRAND_ASSETS.length,5);
 assert.equal(new Set(BRAND_ASSETS.map(a=>a.filename)).size,5);
 for(const a of BRAND_ASSETS) {
   assert.match(a.filename,/^blipmood-(?:wordmark|emblem|social-card)(?:-(?:light|dark))?\.png$/);
   assert.match(a.url,/^https:\/\//);
   assert.match(a.sha256,/^[0-9a-f]{64}$/);
   assert.equal(useLocalBrandAssetUrls(a.url),"/assets/brand/"+a.filename);
 }
 assert.match(build,/await downloadBrandAssets\(output\)/);
 assert.match(build,/publishedFiles/);
 assert.match(build,/useLocalBrandAssetUrls/);
});
test("homepage, theme switcher, mobile icons, staff, and emails use approved images",()=>{
 const shell=read("assets/js/site-shell.js"),home=read("index.html"),inject=read("scripts/inject-site-shell.mjs");
 assert.match(home,/data-bm-logo="wordmark"/);
 assert.match(home,/data-bm-logo="emblem"/);
 assert.match(shell,/synchronizeBrandImages/);
 assert.match(inject,/apple-touch-icon/);
 for(const path of ["netlify/functions/email-worker.js","netlify/functions/_lib/staff-email-template.js"])
   assert.match(read(path),/blipmood-wordmark-dark\.png/);
});
