const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../cloudflare/blipmood-free-cache/src/index.js"), "utf8");

function setup({size=8192,type="video/mp4",status=200}={}) {
  const events=[];
  const media=new Uint8Array(size);
  media.fill(65);
  const fetchMock=async(url,options)=>{
    events.push({url,options});
    const headers={"content-type":type,"content-length":String(size)};
    return new Response(options.method==="HEAD"?null:media,{status,headers});
  };
  const context={Response,Headers,Request,URL,console,fetch:fetchMock};
  vm.runInNewContext(source.replace(/export default\s*\{/, "globalThis.worker = {"),context);
  return {
    events,
    request:(url,options={})=>context.worker.fetch(new Request("https://blipmood-free-media.blipmood-timzee.workers.dev"+url,options))
  };
}

test("free media Worker has no R2 dependency and is safe for two- and three-segment paths",async()=>{
  assert.doesNotMatch(source,/MEDIA_BUCKET|r2_buckets|service_role|SUPABASE_SERVICE_ROLE_KEY/);
  const h=setup();
  assert.equal((await h.request("/media/avatars/portrait.webp")).status,200);
  assert.equal((await h.request("/media/videos/account/video.mp4")).status,200);
  assert.equal((await h.request("/media/topics/topic.mp4")).status,200);
  assert.equal(h.events.length,3);
});
test("server rejects signed, private, expiring, nonmedia and traversal requests",async()=>{
  const h=setup();
  const forbidden=[
   "/media/stories/person/story.jpg",
   "/media/direct-messages/account/message.jpg",
   "/media/story-private-media/account/story.mp4",
   "/media/videos/..%2fsecret.png",
   "/media/videos/person/file",
   "/media/unapproved/a.jpeg"
  ];
  for(const p of forbidden)assert.notEqual((await h.request(p)).status,200,p);
  assert.equal((await h.request("/media/videos/a/clip.mp4?token=signed")).status,400);
  assert.equal((await h.request("/media/videos/a/clip.mp4",{method:"POST"})).status,405);
  assert.equal(h.events.length,0);
});
test("cacheable full 200 permits Cloudflare to slice Range requests and re-use the response",async()=>{
 const h=setup();
 const result=await h.request("/media/videos/u/clip.mp4",{headers:{range:"bytes=0-100"}});
 assert.equal(result.status,200);
 assert.match(result.headers.get("cache-control"),/s-maxage=90/);
 assert.equal(result.headers.get("content-type"),"video/mp4");
 assert.equal(result.headers.get("content-length"),"8192");
 assert.equal(h.events[0].options.method,"GET");
 assert.equal(h.events[0].options.headers.range,undefined);
});
test("large public media fail open to original Supabase URL without storing an extra copy",async()=>{
 const h=setup({size:13*1024*1024});
 const result=await h.request("/media/videos/account/large.mp4");
 assert.equal(result.status,307);
 assert.match(result.headers.get("location"),/^https:\/\/duvbcwwprkzzyzikmcol\.supabase\.co\/storage\/v1\/object\/public\/media\//);
});
test("non-video or image file types cannot enter the cache",async()=>{
 const h=setup({type:"application/json"});
 const r=await h.request("/media/avatars/a.json");
 assert.equal(r.status,307);
});
test("HEAD does not poison full body cache, and health reports free-worker mode",async()=>{
 const h=setup();
 const status=await h.request("/health");
 assert.equal(status.status,200);
 assert.deepEqual(await status.json(),{ok:true,mode:"workers-free-cache",r2:false});
 const head=await h.request("/media/avatars/user/avatar.png",{method:"HEAD"});
 assert.equal(head.status,200);
 assert.match(head.headers.get("cache-control"),/no-store/);
 assert.equal(h.events[0].options.method,"HEAD");
});
test("source and integration remain zero-cost, safe, reversible",()=>{
 const cfg=JSON.parse(fs.readFileSync(path.join(__dirname,"../cloudflare/blipmood-free-cache/wrangler.jsonc"),"utf8"));
 assert.equal(cfg.cache.enabled,true);
 assert.equal(cfg.r2_buckets,undefined);
 const media=fs.readFileSync(path.join(__dirname,"../assets/js/media-delivery.mjs"),"utf8");
 assert.match(media,/const WORKER_ENABLED_BY_DEFAULT = false;/);
 assert.match(media,/!PUBLIC_FOLDERS\.has\(key\.split\("\/"\)\[0\]\)/);
});
