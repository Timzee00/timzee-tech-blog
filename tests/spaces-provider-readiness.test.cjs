const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {handler,_test}=require("../netlify/functions/spaces-capabilities.js");
const config={LIVEKIT_URL:"wss://demo.livekit.cloud/",LIVEKIT_API_KEY:"test-id",LIVEKIT_API_SECRET:"test-secret"};
test("readiness requires validated WebSocket URL and full credentials",()=>{
 assert.equal(_test.audioConfigured(config),true);
 for(const env of [
  {...config,LIVEKIT_URL:"http://demo.livekit.cloud"},
  {...config,LIVEKIT_URL:"wss://demo.livekit.cloud/path"},
  {...config,LIVEKIT_URL:"wss://user:pass@demo.livekit.cloud/"},
  {...config,LIVEKIT_API_KEY:""},
  {...config,LIVEKIT_API_SECRET:" "}
 ])assert.equal(_test.audioConfigured(env),false);
});
test("GET returns only a readiness flag, never secret material",async()=>{
 const original=Object.fromEntries(Object.keys(config).map(k=>[k,process.env[k]]));
 try{
  Object.assign(process.env,config);
  const response=await handler({httpMethod:"GET"});
  assert.equal(response.statusCode,200);
  assert.deepEqual(JSON.parse(response.body),{audioConfigured:true});
  assert.ok(!response.body.includes(config.LIVEKIT_API_SECRET));
  assert.equal(response.headers["Cache-Control"],"no-store");
  assert.equal((await handler({httpMethod:"POST"})).statusCode,405);
 }finally{
  for(const [k,v] of Object.entries(original)){
   if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
 }
});
test("UI disables unconfigured instant rooms and hides expired sessions",()=>{
 const source=fs.readFileSync("assets/js/live-spaces.mjs","utf8");
 assert.match(source,/loadAudioCapabilities/);
 assert.match(source,/if\(f\.timing==="now"&&!state\.audioConfigured\)/);
 assert.match(source,/roomExpired\(r\)/);
 assert.match(source,/option\.disabled=!state\.audioConfigured/);
 // A retryable provider shutdown must remain available even when DB says ended.
 assert.match(source,/const wasScheduled=state\.room\.status==="scheduled"/);
 assert.match(source,/if\(!wasScheduled\)\{/);
 assert.match(source,/await providerControl\("end"\)/);
 assert.match(source,/state\.room\.status!=="ended"/);
});

function endRoomScenario({status="live",audioConfigured=true,providerFails=false}={}){
 const source=fs.readFileSync("assets/js/live-spaces.mjs","utf8");
 const begin=source.indexOf("async function endRoom(){");
 const finish=source.indexOf("async function removeParticipant(",begin);
 assert.ok(begin>=0&&finish>begin,"the host-end control must exist");
 const state={roomId:"00000000-0000-4000-8000-000000000001",room:{status},audioConfigured};
 const calls=[];
 const supabase={rpc:async name=>{calls.push("db:"+name);return{data:true,error:null}}};
 const providerControl=async action=>{calls.push("provider:"+action);if(providerFails)throw Error("LiveKit unavailable")};
 const leave=async()=>{calls.push("leave")};
 const refreshRoom=async()=>{calls.push("refresh")};
 const alertStatus=(message,tone)=>calls.push(tone+":"+message);
 const end=new Function("state","confirm","success","supabase","providerControl","leave","refreshRoom","alertStatus",
  source.slice(begin,finish)+"\nreturn endRoom;");
 const run=end(state,()=>true,result=>{if(result.error)throw result.error;return result.data},
  supabase,providerControl,leave,refreshRoom,alertStatus);
 return {run,calls};
}
test("already-ended sessions allow the host to retry LiveKit shutdown",async()=>{
 const {run,calls}=endRoomScenario({status:"ended"});
 await run();
 assert.deepEqual(calls.slice(0,3),["provider:end","leave","refresh"]);
 assert.match(calls[3],/^success:Room and audio shutdown confirmed/);
});
test("never-started scheduled rooms are cancelled without unnecessary LiveKit deletion",async()=>{
 const {run,calls}=endRoomScenario({status:"scheduled",audioConfigured:false});
 await run();
 assert.deepEqual(calls.slice(0,3),["db:spaces_end","leave","refresh"]);
 assert.match(calls[3],/^success:Scheduled room cancelled/);
});
test("provider failure never claims audio shutdown and preserves retry route",async()=>{
 const {run,calls}=endRoomScenario({status:"live",providerFails:true});
 await run();
 assert.deepEqual(calls.slice(0,3),["db:spaces_end","provider:end","refresh"]);
 assert.match(calls[3],/^error:.*Use Confirm audio stopped to retry/);
 assert.ok(!calls.includes("leave"),"failed provider end must not be acknowledged as successful");
});
test("an unconfigured provider cannot falsely confirm live-audio shutdown",async()=>{
 const {run,calls}=endRoomScenario({status:"live",audioConfigured:false});
 await run();
 assert.deepEqual(calls.slice(0,2),["db:spaces_end","refresh"]);
 assert.match(calls[2],/^error:.*provider is unavailable/i);
});
