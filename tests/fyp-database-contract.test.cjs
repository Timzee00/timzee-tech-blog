const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=fs.readFileSync("assets/js/fyp.js","utf8");
const me="11111111-1111-4111-8111-111111111111";
const contentId="22222222-2222-4222-8222-222222222222";
const makeUuid=()=>"33333333-3333-4333-8333-333333333333";
function extract(name,nextName){
 const start=source.indexOf("async function "+name+"(");
 const end=source.indexOf("async function "+nextName+"(",start);
 if(start<0||end<start)throw Error("Missing "+name);
 return source.slice(start,end);
}
test("video likes include required explicit UUID and match authenticated user",async()=>{
 let inserted=null;
 const ctx={supabase:{from(table){assert.equal(table,"video_likes");return {
   insert(data){inserted=data;return Promise.resolve({error:null});}
 }}},crypto:{randomUUID:makeUuid},
 state:{user:{id:me}},feedCache:{clear(){}},reportAppError(){}};
 const fn=vm.runInNewContext(extract("toggleLike","loadInlineComments")+";toggleLike",ctx);
 const btn={disabled:false,textContent:"♡ Like",getAttribute:()=>"false",
   setAttribute(k,v){assert.equal(k,"aria-pressed");assert.equal(v,"true");}};
 const card={dataset:{contentType:"video",contentId},querySelector:()=>null};
 await fn(card,btn);
 assert.deepEqual(JSON.parse(JSON.stringify(inserted)),
   {id:makeUuid(),video_id:contentId,user_id:me});
});
test("post likes still use correct post_id and generated ID",async()=>{
 let inserted=null;
 const ctx={supabase:{from(table){assert.equal(table,"post_likes");return {
   insert(data){inserted=data;return Promise.resolve({error:null});}
 }}},crypto:{randomUUID:makeUuid},
 state:{user:{id:me}},feedCache:{clear(){}},reportAppError(){}};
 const fn=vm.runInNewContext(extract("toggleLike","loadInlineComments")+";toggleLike",ctx);
 const btn={disabled:false,getAttribute:()=>"false",setAttribute(){}};
 const card={dataset:{contentType:"post",contentId},querySelector:()=>null};
 await fn(card,btn);
 assert.deepEqual(JSON.parse(JSON.stringify(inserted)),
   {id:makeUuid(),post_id:contentId,user_id:me});
});
test("video comments supply mandatory ID and display moderation feedback",async()=>{
 let inserted=null;const status={textContent:""};const button={disabled:false};
 const card={dataset:{contentType:"video",contentId},querySelector:s=>
   s===".fyp-comment-status"?status:null};
 const form={elements:{comment:{value:"This looks useful!"}},
   querySelector:()=>button,reset(){this.cleared=true}};
 const ctx={supabase:{from(table){assert.equal(table,"video_comments");return{
   insert(data){inserted=data;return Promise.resolve({error:null});}
 }}},crypto:{randomUUID:makeUuid},
 state:{user:{id:me,user_metadata:{display_name:"Member"}}},
 loadInlineComments:async()=>{},reportAppError(){}};
 const text=source.slice(source.indexOf("async function submitInlineComment("),
   source.indexOf("function updateUrl()",source.indexOf("async function submitInlineComment(")));
 // Slice includes only the function, not unrelated handlers.
 const fn=vm.runInNewContext(text+";submitInlineComment",ctx);
 await fn(card,form);
 assert.equal(inserted.id,makeUuid());
 assert.equal(inserted.video_id,contentId);
 assert.equal(inserted.user_id,me);
 assert.equal(inserted.body,"This looks useful!");
 assert.equal(status.textContent,"Comment posted.");
 assert.equal(button.disabled,false);
});
test("public video and like tables are queried by their actual schema field names",()=>{
 assert.match(source,/id,video_url,thumbnail_url,title,is_public/);
 assert.match(source,/video_likes/);
 assert.match(source,/video_comments/);
 assert.match(source,/state\.user\.id/);
});
