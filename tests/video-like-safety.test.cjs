const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const src=fs.readFileSync("assets/js/videos-marketplace.js","utf8");
const videoPage=fs.readFileSync("video.html","utf8");
const start=src.indexOf("export async function likeVideo(");
const end=src.indexOf("export async function getVideoLikeCount(",start);
const body=src.slice(start,end).replace(/^export /,"");
function makeLike(mock){
 return vm.runInNewContext(body+";likeVideo",{
  supabase:mock,crypto:{randomUUID:()=>"33333333-3333-4333-8333-333333333333"},
  Date
 });
}
const vid="11111111-1111-4111-8111-111111111111";
const uid="22222222-2222-4222-8222-222222222222";
test("a failed insert does not claim that the user liked the video",async()=>{
 let attempts=0;
 const supabase={from(table){assert.equal(table,"video_likes");return{
   select(){return this},eq(){return this},
   async maybeSingle(){return {data:null,error:null}},
   async insert(data){attempts++;assert.equal(data.id,"33333333-3333-4333-8333-333333333333");return {error:{message:"RLS denied"}}}
 }}};
 const outcome=await makeLike(supabase)(vid,uid);
 assert.equal(attempts,1);
 assert.equal(outcome.liked,false);
 assert.equal(outcome.error.message,"RLS denied");
});
test("a failed unlike does not falsely show the video as unliked",async()=>{
 const supabase={from(){return{
   select(){return this},eq(){return this},
   async maybeSingle(){return {data:{id:"like-1"},error:null}},
   delete(){return {eq(){return {async eq(){return {error:{message:"blocked"}}}}}}}
 }}};
 const outcome=await makeLike(supabase)(vid,uid);
 assert.equal(outcome.liked,true);
 assert.equal(outcome.error.message,"blocked");
});
test("the Reels page does not mutate counts or notify others after a failed like",()=>{
 assert.match(videoPage,/if \(result\?\.error\) \{/);
 assert.match(videoPage,/console\.warn\("Video like failed:"/);
 const p=videoPage.indexOf('const result = await likeVideo(videoId, state.user.id)');
 const guard=videoPage.indexOf('if (result?.error)',p);
 const count=videoPage.indexOf('if (countEl)',p);
 assert.ok(p>=0&&guard>p&&count>guard);
});
