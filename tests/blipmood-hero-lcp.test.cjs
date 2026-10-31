const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");

function buildHeroFixture(){
 const build=read("scripts/build-site.mjs");
 const start=build.indexOf("function optimizeHomeHero(html,version){");
 const end=build.indexOf("\n// Old deployments marked stable URLs",start);
 assert.ok(start>=0&&end>start,"responsive homepage function must exist");
 const functionSource=build.slice(start,end).trim();
 const optimize=new Function("return ("+functionSource+");")();
 const canonical="https://d2ol7oe51mr4n9.cloudfront.net/user_3JR5g6OD2PPsWciJ9XxM8Ue05wO/fc802f03-1c6f-4c85-ab4c-a31f4a6b2981.png";
 const html=read("index.html").split(canonical).join("/assets/brand/blipmood-emblem-dark.png");
 return optimize(html,"0123456789abcdef");
}

test("homepage outputs a phone-sized hero with preload of the same asset",()=>{
 const html=buildHeroFixture();
 const hero=html.match(/<img\b(?=[^>]*data-bm-responsive-hero="true")[^>]*>/i)?.[0]||"";
 const preload=html.match(/<link\b(?=[^>]*rel="preload")(?=[^>]*imagesrcset=)[^>]*>/i)?.[0]||"";
 assert.match(hero,/data-bm-logo="emblem"/);
 assert.match(hero,/src="\/assets\/brand\/blipmood-emblem-dark-420\.png\?v=0123456789abcdef"/);
 assert.match(hero,/srcset="[^"]*180\.png\?v=0123456789abcdef 180w, [^"]*420\.png\?v=0123456789abcdef 420w"/);
 assert.match(hero,/sizes="\(max-width:760px\) 39vw/);
 assert.match(hero,/loading="eager"/);
 assert.match(hero,/fetchpriority="high"/);
 assert.match(preload,/imagesrcset="[^"]*180\.png\?v=0123456789abcdef 180w/);
 assert.match(preload,/imagesizes="\(max-width:760px\) 39vw/);
 assert.doesNotMatch(preload,/href="\/assets\/brand\/blipmood-emblem-dark\.png"/);
});

test("only homepage gets the responsive hero and existing approved images stay untouched in source",()=>{
 const src=read("index.html"),built=read("scripts/build-site.mjs");
 assert.match(src,/data-bm-logo="emblem"/);
 assert.match(src,/rel="preload" href="https:\/\/[^"]+\.png" as="image"/);
 assert.match(built,/if \(file === resolve\(output,"index\.html"\)\) contents=optimizeHomeHero\(contents,assetVersion\);/);
 assert.match(built,/await createResponsiveEmblemAssets\(output\)/);
 assert.match(read("scripts/build-pwa-icons.mjs"),/function resizeTransparent\(source,targetWidth\)/);
 assert.match(read("scripts/build-pwa-icons.mjs"),/for\(const theme of \["light","dark"\]\)/);
 assert.match(read("assets/js/site-shell.js"),/img\.dataset\.bmResponsiveHero==="true"/);
 assert.match(read("assets/js/site-shell.js"),/const srcset=root\+"180\.png"/);
 assert.match(read("assets/js/site-shell.js"),/const root="\/assets\/brand\/blipmood-emblem-"\+theme/);
});

test("public static resources cache for repeat visits but private pages, push and APIs stay fresh",()=>{
 const headers=read("_headers");
 assert.match(headers,/\/assets\/\*[\s\S]*?Cache-Control: public, max-age=604800, stale-while-revalidate=86400/);
 assert.match(headers,/\/\*\.html[\s\S]*?Cache-Control: public, max-age=0, must-revalidate/);
 assert.match(headers,/\/\.netlify\/functions\/\*[\s\S]*?Cache-Control: no-store/);
 assert.match(headers,/\/sw\.js[\s\S]*?Cache-Control: no-cache, no-store, must-revalidate/);
 assert.match(read("sw.js"),/request\.mode==="navigate"/);
 assert.match(read("sw.js"),/request\.headers\.has\("Authorization"\)/);
});
