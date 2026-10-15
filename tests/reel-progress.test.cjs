const test=require("node:test");
const assert=require("node:assert/strict");
const storeModule=import("../assets/js/reel-progress.mjs");
function storage(){const values=new Map();return {
  getItem:key=>values.get(key)||null,
  setItem:(key,value)=>values.set(key,value)
};}
test("resume metadata is isolated and keeps position without caching video bytes",async()=>{
 const {createReelProgressStore}=await storeModule;
 const memory=storage(),clock=()=>10000000;
 const store=createReelProgressStore(memory,{key:"test:member-a",now:clock});
 store.set("clip-1",19,130);assert.equal(store.get("clip-1"),19);
 store.set("clip-1",129,130);assert.equal(store.get("clip-1"),null);
 const other=createReelProgressStore(memory,{key:"test:member-b",now:clock});
 assert.equal(other.get("clip-1"),null);
});
test("resume history is bounded and expires",async()=>{
 const {createReelProgressStore}=await storeModule;
 const memory=storage();let now=5000;
 const store=createReelProgressStore(memory,{now:()=>now,key:"test:bounded",capacity:2});
 store.set("a",6,30);now+=1000;store.set("b",7,30);now+=1000;store.set("c",9,30);
 assert.equal(store.get("a"),null);assert.equal(store.get("b"),7);
 now+=13*3600000;assert.equal(store.get("c"),null);
});
