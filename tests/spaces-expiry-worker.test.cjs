const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const worker=fs.readFileSync("netlify/functions/spaces-expiry-worker.js","utf8");
const schedule=fs.readFileSync("netlify.toml","utf8");
const parent=fs.readFileSync("netlify/functions/automation-maintenance.js","utf8");
function makeWorker({db={safe:true},error=null}={}){
 const calls=[];
 const exports={};
 const mockRequire=name=>{
  if(name==="@supabase/supabase-js")return {createClient:(url,key,opts)=>{
   calls.push(["createClient",url,opts.auth.persistSession]);return db;
  }};
  if(name==="./_lib/spaces-expiry.cjs")return{expireSpaces:async input=>{
   calls.push(["expireSpaces",input.db,input.env.LIVEKIT_API_KEY]);
   if(error)throw error;
   return {checked:1,expired:1,skipped:false};
  }};
  throw Error("Unexpected import "+name);
 };
 new Function("require","exports","process","console",worker)(
  mockRequire,exports,{env:{SUPABASE_URL:"https://example.invalid",SUPABASE_SERVICE_ROLE_KEY:"test",LIVEKIT_API_KEY:"test-id"}},
  {log(){}}
 );
 return {handler:exports.handler,calls,db};
}
test("dedicated schedule isolates audio cleanup from unrelated failures",()=>{
 assert.match(schedule,/\[functions\."spaces-expiry-worker"\]\s+schedule = "\*\/5 \* \* \* \*"/);
 assert.doesNotMatch(parent,/expireSpaces/);
 assert.match(parent,/process_automation_tick/);
});
test("scheduled cleanup invokes its own isolated database client",async()=>{
 const fixture=makeWorker(),response=await fixture.handler();
 assert.equal(response.statusCode,200);
 assert.equal(JSON.parse(response.body).expired,1);
 assert.equal(fixture.calls.filter(([name])=>name==="expireSpaces").length,1);
 assert.equal(fixture.calls[1][1],fixture.db);
});
test("scheduled cleanup propagates provider failures instead of claiming success",async()=>{
 const fixture=makeWorker({error:new Error("LiveKit down")});
 await assert.rejects(fixture.handler(),/LiveKit down/);
});
test("worker cannot run without server-owned database credentials",async()=>{
 const exports={};
 new Function("require","exports","process","console",worker)(
  name=>name==="@supabase/supabase-js"
   ?{createClient:()=>{throw Error("Must not create a client")}}
   :{expireSpaces:async()=>{throw Error("Must not expire rooms")}},
  exports,{env:{}},{log(){}}
 );
 await assert.rejects(exports.handler(),/not configured/);
});
