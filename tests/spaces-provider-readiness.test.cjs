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
 assert.match(source,/if\(hadAudio\)await providerControl\("end"\)/);
});
