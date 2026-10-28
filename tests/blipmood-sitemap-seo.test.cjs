const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {SITE_URL,STATIC_PATHS,buildSitemap,staticEntries}=require("../netlify/functions/_lib/public-sitemap.cjs");
const UUID1="f0c0e288-1296-4c8e-813d-9f6bab399ce1";
const UUID2="f0c0e288-1296-4c8e-813d-9f6bab399ce2";
const UUID3="f0c0e288-1296-4c8e-813d-9f6bab399ce3";
const code=fs.readFileSync("netlify/functions/sitemap.js","utf8");

function buildHandler(tables,env={}){
 const called=[];
 const db={from(table){
  const filters=[];
  const chain={
   select(fields){called.push({table,fields});return chain},
   eq(col,val){filters.push(row=>row[col]===val);return chain},
   order(){return chain},
   limit(n){const value=tables[table];return Promise.resolve(value?.error?{error:value.error}:
    {data:(value||[]).filter(row=>filters.every(fn=>fn(row))).slice(0,n),error:null})}
  };
  return chain;
 }};
 const sandbox={exports:{},require(name){
  if(name==="@supabase/supabase-js")return {createClient:()=>db};
  if(name==="./_lib/public-sitemap.cjs")return require("../netlify/functions/_lib/public-sitemap.cjs");
  throw Error("Unexpected dependency "+name);
 },process:{env},console:{error:()=>{}},Date,encodeURIComponent};
 vm.runInNewContext(code,sandbox,{timeout:2000});
 return {handler:sandbox.exports.handler,called};
}

test("sitemap and robots advertise only the new Blipmood origin",()=>{
 const xml=fs.readFileSync("sitemap.xml","utf8");
 const robots=fs.readFileSync("robots.txt","utf8");
 assert.match(xml,/<urlset xmlns="http:\/\/www.sitemaps.org\/schemas\/sitemap\/0.9">/);
 assert.match(xml,/<loc>https:\/\/blipmood.netlify.app\/</);
 assert.match(robots,/Sitemap: https:\/\/blipmood.netlify.app\/sitemap.xml/);
 assert.doesNotMatch(xml,/timzee-tech-blog|timzee.tech|<changefreq>|<priority>/i);
 const staticPaths=[...xml.matchAll(/<loc>https:\/\/blipmood.netlify.app([^<]*)<\/loc>/g)].map(a=>a[1]);
 assert.deepEqual(staticPaths,STATIC_PATHS);
 assert.equal(staticPaths.length,new Set(staticPaths).size);
 assert.ok(STATIC_PATHS.length>=15);
 for(const path of STATIC_PATHS){
  const file=path==="/"? "index.html":path.slice(1);
  assert.ok(fs.existsSync(file),"sitemap must not advertise a missing page: "+file);
 }
 assert.ok(!STATIC_PATHS.includes("/fyp.html"),"Personalized noindex page must stay out");
 assert.ok(!STATIC_PATHS.includes("/login.html"));
 assert.ok(!STATIC_PATHS.some(p=>p.startsWith("/admin")));
 assert.equal(xml,buildSitemap(staticEntries()));
});

test("missing database keys serve valid static sitemap with 200, not a broken 500",async()=>{
 const {handler}=buildHandler();
 const r=await handler();
 assert.equal(r.statusCode,200);
 assert.match(r.headers["Content-Type"],/application\/xml/);
 assert.equal(r.headers["X-Sitemap-Source"],"static-fallback");
 assert.equal(r.body,buildSitemap(staticEntries()));
 assert.doesNotMatch(r.body,/<error>|\bsecret\b/i);
});

test("published and already-due posts, and only public videos, are discoverable",async()=>{
 const {handler,called}=buildHandler({
  posts:[
   {id:UUID1,status:"published",publish_at:null,updated_at:"2026-10-28T00:00:00Z"},
   {id:UUID2,status:"published",publish_at:"2099-01-01T00:00:00Z",updated_at:"2026-10-28"},
   {id:UUID3,status:"draft",publish_at:null,updated_at:"2026-10-28"}
  ],
  videos:[
   {id:UUID2,is_public:true,updated_at:"2026-10-27"},
   {id:UUID3,is_public:false,updated_at:"2026-10-27"}
  ]
 },{SUPABASE_URL:"https://fake.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"mock-only"});
 const r=await handler();
 assert.equal(r.statusCode,200);
 assert.equal(r.headers["X-Sitemap-Source"],"public-content");
 assert.match(r.body,new RegExp("post.html\\?id="+UUID1));
 assert.match(r.body,new RegExp("video.html\\?id="+UUID2));
 assert.doesNotMatch(r.body,new RegExp(UUID3));
 assert.equal(r.body.includes("post.html?id="+UUID2),false);
 assert.match(r.body,/<lastmod>2026-10-28<\/lastmod>/);
 assert.equal(called.length,2);
 assert.ok(!r.body.includes("fake.supabase.co"));
});

test("failed database query uses safe static content without leaking privileged rows",async()=>{
 const {handler}=buildHandler({posts:{error:new Error("DB timeout")}},
  {SUPABASE_URL:"https://fake.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"mock-only"});
 const r=await handler();
 assert.equal(r.statusCode,200);
 assert.equal(r.headers["X-Sitemap-Source"],"static-fallback");
 assert.equal(r.body,buildSitemap(staticEntries()));
});

test("sitemap XML escapes untrusted content, skips duplicates and rejects invalid dates",()=>{
 const result=buildSitemap([{path:"/section?a=1&b=2",updated_at:"invalid"},
  {path:"/section?a=1&b=2"},{path:"//evil.com/"}]);
 assert.match(result,/a=1&amp;b=2/);
 assert.equal((result.match(/<url>/g)||[]).length,1);
 assert.doesNotMatch(result,/<lastmod>/);
 assert.doesNotMatch(result,/evil.com/);
 assert.equal(SITE_URL,"https://blipmood.netlify.app");
});

test("indexable public pages get self-canonical links at build time without touching noindex pages",async()=>{
 const {injectSocialDefaults}=await import("../scripts/inject-social-meta.mjs");
 for(const page of ["spaces.html","videos.html","novels.html","marketplace.html","terms.html"]){
  const html=fs.readFileSync(page,"utf8");
  const built=injectSocialDefaults(html,page);
  const canonical="https://blipmood.netlify.app/"+page;
  assert.match(built,new RegExp('<link rel="canonical" href="'+canonical.replace(/\\./g,"\\.")+'">'));
  assert.equal((built.match(/rel="canonical"/g)||[]).length,1);
  assert.equal(injectSocialDefaults(built,page),built);
 }
 const fyp=fs.readFileSync("fyp.html","utf8");
 assert.match(fyp,/noindex/);
 assert.doesNotMatch(injectSocialDefaults(fyp,"fyp.html"),/rel="canonical"/);
});

test("Blipmood Google site-name markup is explicit and consistent",()=>{
 const home=fs.readFileSync("index.html","utf8");
 const match=home.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
 assert.ok(match);
 const data=JSON.parse(match[1]);
 assert.equal(data["@type"],"WebSite");
 assert.equal(data.name,"Blipmood");
 assert.equal(data.url,"https://blipmood.netlify.app/");
 assert.ok(data.alternateName.includes("blipmood.netlify.app"));
 assert.match(home,/<meta property="og:site_name" content="Blipmood"/);
 assert.match(home,/<link rel="canonical" href="https:\/\/blipmood.netlify.app\/"/);
 assert.match(home,/name="google-site-verification"/);
});
