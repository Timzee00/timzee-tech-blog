const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {getMeta,renderHTML,safeOrigin,validUrl,ROUTES}=require("../netlify/functions/_lib/share-preview.cjs");
const BASE="https://timzee-tech-blog.netlify.app";
const A="0ca1d374-4335-4f07-bdd3-973d429e3016";
const B="0ca1d374-4335-4f07-bdd3-973d429e3017";
function mockDB(tables){
 const calls=[];
 return {calls,from(table){
  const rules=[]; const chain={
   select(fields){calls.push({table,fields});return chain;},
   eq(field,value){rules.push(row=>row[field]===value);return chain;},
   in(field,values){rules.push(row=>values.includes(row[field]));return chain;},
   gt(field,value){rules.push(row=>new Date(row[field])>new Date(value));return chain;},
   order(){return chain;},limit(){return chain;},
   async maybeSingle(){return {data:(tables[table]||[]).find(row=>rules.every(check=>check(row)))||null,error:null};}
  };return chain;
 }};
}
const query=q=>new URLSearchParams(q);
test("public article returns its own escaped title and first real image",async()=>{
 const db=mockDB({posts:[{id:A,title:'News & Tomorrow',status:"published",content:'<p>Hello</p><img src="https://images.example.com/real.jpg">',feed_excerpt:"Big news today",created_at:"2026-10-20",cover:""}]});
 const meta=await getMeta("post",query("id="+A),db,BASE,"/post.html");
 assert.equal(meta.found,true);
 assert.equal(meta.title,"News & Tomorrow");
 assert.equal(meta.image,"https://images.example.com/real.jpg");
 assert.match(meta.canonical,/post\.html\?id=/);
 const markup=renderHTML(meta);
 assert.match(markup,/og:title/);assert.match(markup,/twitter:image/);
 assert.ok(markup.includes("News &amp; Tomorrow"));
 assert.doesNotMatch(markup,/<the Future>/);
});
test("drafts and scheduled posts produce only generic previews",async()=>{
 for(const post of [{id:A,title:"Secret draft",status:"draft"}, {id:A,title:"Future post",status:"published",publish_at:"2099-01-01"}]){
  const meta=await getMeta("post",query("id="+A),mockDB({posts:[post]}),BASE,"/post.html");
  assert.equal(meta.found,false);
  assert.doesNotMatch(JSON.stringify(meta),/Secret draft|Future post/);
 }
});
test("private reels, communities and stories cannot leak public previews",async()=>{
 const video=await getMeta("video",query("id="+A),mockDB({videos:[{id:A,is_public:false,title:"Private reel"}]}),BASE,"/video.html");
 assert.equal(video.found,false);
 const db=mockDB({community_threads:[{id:A,title:"Hidden discussion",status:"published",community_id:B}],
   discussion_topics:[{id:B,visibility:"private",community_state:"active",title:"Private board"}]});
 const community=await getMeta("discussion",query("thread="+A),db,BASE,"/discussion.html");
 assert.equal(community.found,false);
 const story=await getMeta("stories",query("story="+A),mockDB({stories:[{id:A,visibility:"friends",expires_at:"2099-01-01",caption:"secret"}]}),BASE,"/stories.html");
 assert.equal(story.found,false);
});
test("public video includes its own video metadata and poster, not the homepage",async()=>{
 const db=mockDB({videos:[{id:A,title:"My original reel",description:"Original clip",is_public:true,
 thumbnail_url:"https://images.example.com/poster.jpg",video_url:"https://cdn.example.com/clip.mp4"}]});
 const meta=await getMeta("video",query("id="+A),db,BASE,"/video.html");
 assert.equal(meta.title,"My original reel");
 assert.equal(meta.image,"https://images.example.com/poster.jpg");
 const html=renderHTML(meta);
 assert.match(html,/og:video:type/);assert.match(html,/video\/mp4/);
 assert.match(html,/poster\.jpg/);assert.match(html,/clip\.mp4/);
});
test("URL security rejects malicious images and forged origins",()=>{
 assert.equal(validUrl("javascript:alert(1)",BASE),"");
 assert.equal(validUrl("",BASE),"");
 assert.equal(validUrl("   ",BASE),"");
 assert.equal(validUrl(undefined,BASE),"");
 assert.equal(validUrl("https://localhost/admin",BASE),"");
 assert.equal(safeOrigin("https://evil.example.net",BASE),BASE);
 assert.equal(safeOrigin("https://main--timzee-tech-blog.netlify.app",BASE),"https://main--timzee-tech-blog.netlify.app");
});
test("the edge function handles only preview crawlers and leaves human visits untouched",async()=>{
 const {default:edge,config}=await import("../netlify/edge-functions/social-preview.js");
 const url=BASE+"/post.html?id="+A;
 const human=edge(new Request(url,{headers:{"user-agent":"Mozilla/5.0 Android Chrome"}}));
 assert.equal(human,undefined);
 const preview=edge(new Request(url,{headers:{"user-agent":"facebookexternalhit/1.1"}}));
 assert.ok(preview instanceof URL);
 assert.match(preview.pathname,/\/\.netlify\/functions\/share-preview/);
 assert.equal(preview.searchParams.get("id"),A);
 assert.equal(edge(new Request(BASE+"/post.html",{headers:{"user-agent":"Twitterbot"}})),undefined);
 assert.ok(config.path.includes("/video.html"));
});
test("static content sections get safe brand OG metadata at build time",async()=>{
 const {injectSocialDefaults}=await import("../scripts/inject-social-meta.mjs");
 const html=injectSocialDefaults('<!doctype html><head><title>Videos | Blipmood</title><meta name="description" content="Discover reels"></head><body></body>','videos.html');
 assert.match(html,/property="og:image"/);assert.match(html,/name="twitter:card"/);
 assert.match(html,/content="Videos \| Blipmood"/);
 assert.equal((injectSocialDefaults(html,"videos.html").match(/property="og:image"/g)||[]).length,1);
 assert.equal(injectSocialDefaults(html,"admin/login.html"),html);
});
test("the public share endpoints do not embed a service role key in browser code",()=>{
 const edge=fs.readFileSync("netlify/edge-functions/social-preview.js","utf8");
 const backend=fs.readFileSync("netlify/functions/share-preview.js","utf8");
 assert.doesNotMatch(edge,/SERVICE_ROLE_KEY/);
 assert.match(backend,/process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
 assert.match(backend,/Cache-Control/);
});