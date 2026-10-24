const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=fs.readFileSync("assets/js/reader-interest-ranker.mjs","utf8").replace(/^export\s+/gm,"");
const ctx={Date,Number,Math,String,Set,Map,Object};
vm.runInNewContext(source+"\nthis.rank=recommendForInterests;",ctx,{timeout:1000});
const rank=ctx.rank;
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const posts=[
 {id:id(1),title:"Advanced Python guide",tags:["Python","developer"],status:"published",
  created_at:"2026-10-10T10:00:00Z"},
 {id:id(2),title:"The top smartphones of 2026",tags:["gadgets"],status:"published",
  created_at:"2026-10-12T10:00:00Z"},
 {id:id(3),title:"Security patterns for production software",tags:["cybersecurity"],status:"published",
  created_at:"2026-10-11T10:00:00Z"},
 {id:id(4),title:"AI writing assistants",tags:["ai"],status:"draft",
  created_at:"2026-10-12T10:00:00Z"},
 {id:id(5),title:"Future programming guide",tags:["python"],status:"published",
  publish_at:"2099-10-10T10:00:00Z"}
];
test("matched recommendations prioritize chosen topics, without private drafts or future items",()=>{
 const result=rank(posts,["Programming","Cybersecurity"]);
 assert.equal(result.length,2);
 // Both score 7; newer published article wins the deterministic tie-break.
 assert.equal(result[0].id,id(3));
 assert.equal(result[1].id,id(1));
});
test("opt-out/no interests produces no recommendations and excludes already featured posts",()=>{
 assert.equal(rank(posts,[]).length,0);
 assert.equal(rank(posts,["Untrusted Topic"]).length,0);
 const result=rank(posts,["Gadgets"],[],[id(2)]);
 assert.equal(result.length,0);
});
test("interests honor category and recommendation count limits",()=>{
 const categoryPosts=[
  {id:id(6),title:"News from the lab",category_id:id(21),status:"published"},
  {id:id(7),title:"More lab news",category_id:id(21),status:"published"}
 ];
 const categories=[{id:id(21),name:"Cybersecurity"}];
 assert.equal(rank(categoryPosts,["Cybersecurity"],categories,[],1).length,1);
 assert.ok(rank([...posts,...categoryPosts],["Technology","Cybersecurity","Programming","Gadgets"],categories,[],500).length<=6);
});
test("interest recommendations reuse the feed and respect the existing recommendations setting",()=>{
 const src=fs.readFileSync("assets/js/reader-home.mjs","utf8");
 assert.match(src,/recommendForInterests\(posts,interests,categories,usedIds,4\)/);
 assert.match(src,/preferences\?\.feed\?\.showRecommendations===false/);
 assert.match(src,/community_user_interests/);
 assert.match(src,/\.limit\(14\)/);
 const app=fs.readFileSync("assets/js/app.js","utf8");
 assert.match(app,/mountReaderHome\(state\.user,\{posts:state\.posts,categories:state\.categories\}\)/);
});
