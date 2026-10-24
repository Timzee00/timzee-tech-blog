const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const source=fs.readFileSync("assets/js/live-spaces.mjs","utf8");
const begin=source.indexOf("function configureControls(){");
const end=source.indexOf("async function loadPeople(){",begin);
assert.ok(begin>=0&&end>begin,"configureControls must be present");
function view({role="host",connected=false,joined=true,expired=false,status="live"}={}){
 const elements=new Map();
 const $=id=>{
  if(!elements.has(id))elements.set(id,{
   hidden:false,textContent:"",classList:{toggle(){}}
  });
  return elements.get(id);
 };
 const owner="00000000-0000-4000-8000-000000000001";
 const state={
  room:{owner_id:owner,status,allow_requests:true},
  user:{id:role==="host"?owner:"00000000-0000-4000-8000-000000000002"},
  joined,role,livekit:connected?{}:null,audioConfigured:true
 };
 const script=source.slice(begin,end)+";configureControls();";
 new Function("state","$","roomExpired","loadRequests",script)(
  state,$,()=>expired,()=>{}
 );
 return $("spaceReconnect");
}
test("host can retry audio without leaving the live Space",()=>{
 const r=view({role:"host",connected:false});
 assert.equal(r.hidden,false);
 assert.equal(r.textContent,"↻ Reconnect audio");
});
test("connected host does not get an unnecessary refresh control",()=>{
 assert.equal(view({role:"host",connected:true}).hidden,true);
});
test("listeners and speakers retain permission refresh and audio retry",()=>{
 assert.equal(view({role:"listener",connected:false}).hidden,false);
 const listener=view({role:"listener",connected:true});
 assert.equal(listener.hidden,false);
 assert.equal(listener.textContent,"↻ Refresh speaking access");
 assert.equal(view({role:"speaker",connected:true}).hidden,false);
});
test("reconnect stays hidden for guests, ended and expired sessions",()=>{
 assert.equal(view({joined:false}).hidden,true);
 assert.equal(view({status:"ended"}).hidden,true);
 assert.equal(view({expired:true}).hidden,true);
});
