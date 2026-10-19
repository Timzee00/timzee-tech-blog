const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=fs.readFileSync("assets/js/verified-identity.mjs","utf8").replace(/^export\s+/gm,"");
const context={Date,Map,Set,String,Number,Object,RegExp};
vm.runInNewContext(source+"\nthis.identity={loadVerifiedIdentityMap};",context);
const load=context.identity.loadVerifiedIdentityMap;
const ids=Array.from({length:161},(_,i)=>"00000000-0000-4000-8000-"+i.toString(16).padStart(12,"0"));
function mockClient(){
 const calls=[];
 const client={from(table){
  assert.equal(table,"public_profiles");
  return {select(fields){
   assert.match(fields,/verification_expires_at/);
   return {async in(field,items){
    assert.equal(field,"id");
    calls.push([...items]);
    return {data:items.map(id=>({id,is_verified:true,verification_tier:"silver",frame_style:"library"})),error:null};
   }};
  }};
 }};
 return {client,calls};
}
test("identity lookups batch 80 IDs, cap at 160, and reuse fresh cache",async()=>{
 const {client,calls}=mockClient(),cache=new Map();
 const first=await load(client,ids,cache);
 assert.equal(first.size,160);
 assert.deepEqual(calls.map(x=>x.length),[80,80]);
 const again=await load(client,ids.slice(0,20),cache);
 assert.equal(again.size,20);
 assert.equal(calls.length,2);
});
test("expired and malformed cache entries are fetched again",async()=>{
 const {client,calls}=mockClient(),cache=new Map();
 cache.set(ids[0],{profile:{id:ids[0],is_verified:true},expiresAt:Date.now()-1});
 cache.set(ids[1],{profile:{id:ids[1],is_verified:true},expiresAt:NaN});
 cache.set(ids[2],null);
 const result=await load(client,ids.slice(0,3),cache);
 assert.equal(result.size,3);
 assert.equal(calls.length,1);
 assert.equal(calls[0].length,3);
 assert.equal(result.get(ids[1]).verification_tier,"silver");
});
test("invalid IDs never enter identity lookup queries",async()=>{
 const {client,calls}=mockClient();
 const result=await load(client,["not-an-id",ids[0],ids[0],"x".repeat(200)]);
 assert.equal(result.size,1);
 assert.deepEqual(calls.map(x=>x.length),[1]);
});
