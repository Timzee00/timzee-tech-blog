const test=require("node:test");
const assert=require("node:assert/strict");
const helper=import("../assets/js/video-discovery.mjs");
const ONE="11111111-1111-4111-8111-111111111111", TWO="22222222-2222-4222-8222-222222222222";
function mockFeed(reqs){
 return {
   rpc:async(name,args)=>{reqs.push({name,args});return {data:[
     {video_id:TWO},
     {video_id:ONE},
     {video_id:TWO}
   ],error:null}},
   from(table){assert.equal(table,"videos");return {
     select(){return this},
     eq(column,value){assert.equal(column,"is_public");assert.equal(value,true);return this},
     async in(column,ids){
       assert.equal(column,"id");
       return {data:ids.map(id=>({id,is_public:true,title:id})),error:null};
     }
   }}
 };
}
test("For You clips retain ranked order without duplicating candidates",async()=>{
 const {fetchVideoDiscoveryPage}=await helper;
 const calls=[];
 const clips=await fetchVideoDiscoveryPage(mockFeed(calls),{mode:"for-you",userId:"member-a",force:true,limit:1,offset:0});
 assert.deepEqual(clips.map(x=>x.id),[TWO]);
 assert.equal(calls[0].name,"blipmood_video_feed_ids");
 assert.equal(calls[0].args.p_mode,"for-you");
});
test("Following uses distinct RPC and cache partitions by member",async()=>{
 const {fetchVideoDiscoveryPage}=await helper;const calls=[];
 const client=mockFeed(calls);
 await fetchVideoDiscoveryPage(client,{mode:"following",userId:"member-a",force:true});
 await fetchVideoDiscoveryPage(client,{mode:"following",userId:"member-b"});
 assert.equal(calls.length,2);
 assert.equal(calls[0].name,"blipmood_video_feed_ids");
 assert.equal(calls[0].args.p_mode,"following");
});
test("Unknown mode fails closed",async()=>{
 const {fetchVideoDiscoveryPage}=await helper;
 await assert.rejects(fetchVideoDiscoveryPage({},{mode:"unknown"}),/Unknown/);
});

test("cold-start For You shows bounded public videos and caches the result", async () => {
 const {fetchVideoDiscoveryPage}=await helper;
 let rpcCalls=0, publicQueries=0;
 const sb={
  rpc:async()=>{rpcCalls++;return {data:[],error:null};},
  from(name){assert.equal(name,"videos");return {
    select(){return this;},eq(column,value){assert.equal(column,"is_public");assert.equal(value,true);return this;},
    order(){return this;},
    async range(start,end){assert.equal(start,0);assert.equal(end,49);publicQueries++;return {data:[{id:ONE,is_public:true}],error:null};}
  };}
 };
 const first=await fetchVideoDiscoveryPage(sb,{mode:"for-you",userId:"cold-user",force:true});
 const next=await fetchVideoDiscoveryPage(sb,{mode:"for-you",userId:"cold-user"});
 assert.equal(first.length,1);assert.equal(next.length,1);
 assert.equal(rpcCalls,1);assert.equal(publicQueries,1);
});
test("empty Following stays empty and is cached rather than turning into Latest", async () => {
 const {fetchVideoDiscoveryPage}=await helper;
 let count=0;
 const sb={rpc:async()=>{count++;return {data:[],error:null};},from:()=>{throw Error("Must not query Latest on Following");}};
 const one=await fetchVideoDiscoveryPage(sb,{mode:"following",userId:"empty-follower",force:true});
 const two=await fetchVideoDiscoveryPage(sb,{mode:"following",userId:"empty-follower"});
 assert.deepEqual(one,[]);assert.deepEqual(two,[]);assert.equal(count,1);
});
test("unauthorized video rankings do not leak public fallback into Following", async () => {
 const {fetchVideoDiscoveryPage}=await helper;
 const sb={rpc:async()=>({error:{code:"42501",message:"denied"}}),from:()=>{throw Error("No fallback permitted");}};
 await assert.rejects(fetchVideoDiscoveryPage(sb,{mode:"following",userId:"blocked-user"}),error=>error.code==="42501");
});
