const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=fs.readFileSync("assets/js/live-spaces.mjs","utf8");
const start=source.indexOf("async function connectJoinedRoom(){");
const end=source.indexOf("function stopPolling(){",start);
assert.ok(start>=0&&end>start);
const fragment=source.slice(start,end);
async function runJoin(shouldFail){
 const state={roomId:"room",role:"listener",joined:false,livekit:null};
 const messages=[],audio=[];
 const deps={state,authRequired:()=>true,
  success:v=>v.data,supabase:{rpc:async()=>({data:"listener",error:null})},
  refreshRoom:async()=>{},startPolling:()=>{},alertStatus:(message,tone)=>messages.push({message,tone}),
  startAudio:async()=>{if(shouldFail)throw Error("Audio offline")},
  audioStatus:s=>audio.push(s),configureControls:()=>{}};
 const code="(function(d){const {state,authRequired,success,supabase,refreshRoom,startPolling,alertStatus,startAudio,audioStatus,configureControls}=d;"+
   fragment+";return join;})";
 const join=vm.runInNewContext(code,{Error},{timeout:1500})(deps);
 await join();
 return {state,messages,audio};
}
test("audio success reported only after it connects",async()=>{
 const ok=await runJoin(false);
 assert.equal(ok.state.joined,true);
 assert.equal(ok.messages.at(-1).tone,"success");
});
test("failed audio keeps room membership but explicitly warns",async()=>{
 const failed=await runJoin(true);
 assert.equal(failed.state.joined,true);
 assert.equal(failed.messages.at(-1).tone,"error");
 assert.match(failed.messages.at(-1).message,/audio did not connect/);
 assert.match(failed.audio.at(-1),/Audio offline/);
});
test("reconnect checks heartbeat and renews server-granted speaking role",()=>{
 assert.match(source,/if\(heartbeat\.error\|\|!heartbeat\.data\)/);
 assert.match(source,/state\.role=success\(await supabase\.rpc\("spaces_join"/);
 assert.match(source,/if\(state\.livekit!==livekit\)return/);
});

test("intentional audio Leave cannot cause a false provider-disconnect warning",()=>{
 assert.match(source,/const existing=state\.livekit;state\.livekit=null/);
 assert.match(source,/existing\.disconnect\(\)/);
 assert.match(source,/if\(state\.livekit!==livekit\)return/);
});
test("ended rooms retain a working host path to confirm audio shutdown",()=>{
 assert.match(source,/const wasScheduled=state\.room\.status==="scheduled"/);
 assert.match(source,/if\(!wasScheduled\)\{/);
 assert.match(source,/await providerControl\("end"\)/);
 assert.match(source,/Room and audio shutdown confirmed/);
 assert.match(source,/state\.room\.status!=="ended"/);
});
