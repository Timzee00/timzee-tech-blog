const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const crypto=require("node:crypto");
const read=path=>fs.readFileSync(path,"utf8");
const sql=read("supabase/migrations/20261028234500_reel_public_identity_and_guest_views.sql");
const handlerCode=read("netlify/functions/video-view.js");
const player=read("video.html"),feed=read("assets/js/fyp.js");
const data=read("assets/js/videos-marketplace.js");
const UUID="f0c0e288-1296-4c8e-813d-9f6bab399ce1";
const makeEvent=(extras={})=>({
 httpMethod:"POST",headers:{
  host:"blipmood.netlify.app",origin:"https://blipmood.netlify.app",
  "x-nf-client-connection-ip":"197.210.0.2",
  "user-agent":"Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 Chrome/133.0",...extras
 },body:JSON.stringify({videoId:UUID})
});
function handlerFactory(onRpc=async()=>({data:true,error:null})){
 let calls=[];
 const fakeClient={rpc:async(name,args)=>{calls.push({name,args});return onRpc(name,args)}};
 const context={
  exports:{},process:{env:{SUPABASE_SERVICE_ROLE_KEY:"server-secret-not-public",
    SUPABASE_URL:"https://example.supabase.co"}},
  console:{error:()=>{}},URL,
  require(name){
   if(name==="node:crypto")return crypto;
   if(name==="@supabase/supabase-js")return {createClient:()=>fakeClient};
   throw Error("Unexpected dependency "+name);
  }
 };
 vm.runInNewContext(handlerCode,context,{timeout:1500});
 return {handler:context.exports.handler,calls};
}

test("public reel metadata exposes usernames and actual counts but never private email",()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.reel_public_metadata/);
 assert.match(sql,/SECURITY INVOKER/);
 assert.match(sql,/JOIN public\.public_profiles pp ON pp\.id=v\.user_id/);
 assert.match(sql,/v\.is_public IS TRUE/);
 assert.match(sql,/pp\.username/);
 assert.doesNotMatch(sql,/pp\.email|pp\.display_name|v\.author_name/);
 assert.match(player,/supabase\.rpc\("reel_public_metadata"/);
 assert.match(player,/publicById\.get\(v\.id\)/);
 assert.match(player,/uploader_profile\.username=validated/);
 assert.match(player,/\.select\("id,username"\)\.in\("id",userIds\)/);
 assert.match(player,/if\(publicRow\?\.view_count!==undefined\)/);
});
test("guests and signed-in viewers both reach a secure view-counting path",()=>{
 assert.match(player,/video\.addEventListener\("playing"/);
 assert.match(player,/document\.visibilityState==="hidden"/);
 assert.match(player,/state\.activeIndex!==Number\(el\.dataset\.index\)/);
 assert.doesNotMatch(player,/if\(!state\.user\?\.id\|\|state\.viewAttempts\.has/);
 assert.match(feed,/incrementVideoView\(card\.dataset\.contentId\)/);
 assert.doesNotMatch(feed,/if\(!state\.user\?\.id\|\|viewAttempted\)return/);
 assert.match(data,/supabase\.rpc\("record_video_view"/);
 assert.match(data,/fetch\("\/\.netlify\/functions\/video-view"/);
 assert.match(data,/credentials:"omit"/);
});
test("anonymous server view receipts are authenticated, rate-limited and private",()=>{
 assert.match(sql,/CREATE TABLE IF NOT EXISTS app_private\.video_guest_view_events/);
 assert.match(sql,/PRIMARY KEY\(video_id,visitor_hash,viewed_on\)/);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON TABLE app_private\.video_guest_view_events FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.record_guest_video_view\(uuid,text,text\)/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.record_guest_video_view\(uuid,text,text\)\s+TO service_role/);
 assert.match(sql,/ON CONFLICT \(video_id,visitor_hash,viewed_on\) DO NOTHING/);
 assert.match(sql,/ip_hash=p_ip_hash AND viewed_on=today\)>=150/);
 assert.match(sql,/SET view_count=GREATEST\(COALESCE\(view_count,0\),0\)\+1/);
 assert.doesNotMatch(sql,/GRANT EXECUTE ON FUNCTION public\.record_guest_video_view\(uuid,text,text\)\s+TO anon/);
});
test("guest video-view endpoint accepts a genuine same-origin watch with opaque hashes",async()=>{
 const {handler,calls}=handlerFactory();
 const response=await handler(makeEvent());
 assert.equal(response.statusCode,200);
 assert.equal(JSON.parse(response.body).credited,true);
 assert.equal(calls.length,1);
 assert.equal(calls[0].name,"record_guest_video_view");
 assert.equal(calls[0].args.p_video_id,UUID);
 assert.match(calls[0].args.p_visitor_hash,/^[0-9a-f]{64}$/);
 assert.match(calls[0].args.p_ip_hash,/^[0-9a-f]{64}$/);
 assert.notEqual(calls[0].args.p_ip_hash,calls[0].args.p_visitor_hash);
 assert.doesNotMatch(JSON.stringify(calls),/197\.210\.0\.2|Mozilla|server-secret-not-public/);
 assert.equal(response.headers["Cache-Control"],"no-store");
});
test("cross-site requests, unknown IPs and malformed inputs do not write any view",async()=>{
 const {handler,calls}=handlerFactory();
 const cases=[
  makeEvent({origin:"https://attack.example"}),
  makeEvent({"sec-fetch-site":"cross-site"}),
  makeEvent({"x-nf-client-connection-ip":""}),
  {...makeEvent(),httpMethod:"GET"},
  {...makeEvent(),body:JSON.stringify({videoId:"../../etc/passwd"})},
  {...makeEvent(),body:"not-json"},
  makeEvent({"user-agent":"Googlebot/2.1"})
 ];
 for(const event of cases){
  const response=await handler(event);
  assert.notEqual(JSON.parse(response.body).credited,true);
 }
 assert.equal(calls.length,0);
});
test("duplicate receipts and database outages never fake an increment",async()=>{
 const {handler}=handlerFactory(async()=>({data:false,error:null}));
 let reply=await handler(makeEvent());
 assert.equal(JSON.parse(reply.body).credited,false);
 const failing=handlerFactory(async()=>({data:null,error:{code:"42501"}}));
 reply=await failing.handler(makeEvent());
 assert.equal(reply.statusCode,503);
 assert.equal(JSON.parse(reply.body).credited,false);
});
