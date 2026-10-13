const test=require("node:test");
const assert=require("node:assert/strict");
const helper=import("../assets/js/video-discovery.mjs");
const ONE="11111111-1111-4111-8111-111111111111", TWO="22222222-2222-4222-8222-222222222222";
function mockFeed(reqs){
 return {
   rpc:async(name,args)=>{reqs.push({name,args});return {data:[
     {content_type:"video",content_id:TWO},
     {content_type:"video",content_id:ONE},
     {content_type:"post",content_id:"ignore"},
     {content_type:"video",content_id:TWO}
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
 assert.equal(calls[0].name,"get_personalized_feed");
 assert.equal(calls[0].args.p_content_type,"video");
});
test("Following uses distinct RPC and cache partitions by member",async()=>{
 const {fetchVideoDiscoveryPage}=await helper;const calls=[];
 const client=mockFeed(calls);
 await fetchVideoDiscoveryPage(client,{mode:"following",userId:"member-a",force:true});
 await fetchVideoDiscoveryPage(client,{mode:"following",userId:"member-b"});
 assert.equal(calls.length,2);
 assert.equal(calls[0].name,"get_following_feed");
});
test("Unknown mode fails closed",async()=>{
 const {fetchVideoDiscoveryPage}=await helper;
 await assert.rejects(fetchVideoDiscoveryPage({},{mode:"unknown"}),/Unknown/);
});
