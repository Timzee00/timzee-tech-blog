const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {normalizedArticle}=require("../netlify/functions/_lib/editorial-draft.cjs");
const {loadHandler}=require("./helpers.cjs");
const phrase=(tag,count)=>Array.from({length:count},(_,i)=>
  tag+" observation "+(i+1)+" outlines practical product context and what a reader should verify before drawing a conclusion.").join(" ");
function validResponse(){
  return {
    headline:"An explanatory report based on checked source material",
    introduction:phrase("Introduction",7),conclusion:phrase("Conclusion",6),
    dek:"An original source-linked editorial draft",
    sections:Array.from({length:5},(_,i)=>({
      heading:"Finding "+(i+1),
      paragraphs:[phrase("Background",5),phrase("Detailed context",4)]
    })),
    takeaways:[
      "Readers should confirm the service documentation and account limitations before making production changes.",
      "Teams can review the original source for context and separately verify operational assumptions."
    ],
    verification_notes:["Check the original release date"]
  };
}
test("AI article formatter keeps markup as an array until after takeaways insertion",()=>{
  const result=normalizedArticle(JSON.stringify(validResponse()),"https://example.org/report","Original publisher");
  assert.equal(typeof result.content,"string");
  assert.match(result.content,/data-timzee-takeaways/);
  assert.match(result.content,/Original publisher/);
  assert.match(result.content,/Conclusion/);
  assert.ok(result.wordCount>=450);
  assert.ok(Array.isArray(result.warnings));
});
test("AI article formatter escapes model-produced HTML and does not trust markup",()=>{
  const d=validResponse();d.sections[0].heading="<script>alert(1)</script> Context";
  const result=normalizedArticle(d,"https://example.org/report","Source");
  assert.doesNotMatch(result.content,/<script>/i);
  assert.match(result.content,/<h2>alert\(1\) Context<\/h2>/);
});
function editorialDb(post){
  const calls=[];
  return {
    calls,
    auth:{getUser:async()=>({data:{user:{id:"11111111-1111-4111-8111-111111111111"}},error:null})},
    from(table){
      const result=table==="profiles"?{role:"super",account_status:"active"}:post;
      return {select(){return this},eq(){return this},update(){calls.push("update");return this},
        async maybeSingle(){return {data:result,error:null}}};
    },
    async rpc(name){
      calls.push(name);
      if(name==="consume_ai_rate_limit")return{data:{allowed:true},error:null};
      throw Error("Unexpected RPC: "+name);
    }
  };
}
const samplePost={
  id:"22222222-2222-4222-8222-222222222222",
  title:"Source-only headline",source_name:"News provider",source_url:"https://example.org/report",
  content:"<p>"+phrase("Brief",1)+"</p><p>Editorial status: Source brief.</p>",
  excerpt:"Brief excerpt",description:"An excerpt from the original report.",
  status:"draft",is_posted:false
};
test("short RSS excerpts return useful instructions without calling the AI",async()=>{
  const db=editorialDb(samplePost);let providerRequests=0;
  const handler=loadHandler("curator-expand-article",db,{
    env:{GROQ_API_KEY:"test-key"},
    fetch:async()=>{providerRequests++;throw Error("Do not call provider");}
  });
  const result=await handler({httpMethod:"POST",headers:{authorization:"Bearer editor-test"},
    body:JSON.stringify({id:samplePost.id})});
  assert.equal(result.statusCode,422);
  assert.match(JSON.parse(result.body).error,/Additional verified reporting/i);
  assert.equal(providerRequests,0);
  assert.equal(db.calls.includes("update"),false);
});
test("editor-supplied reporting requires a checked public source URL",async()=>{
  const db=editorialDb(samplePost);let providerRequests=0;
  const handler=loadHandler("curator-expand-article",db,{
    env:{GROQ_API_KEY:"test-key"},
    fetch:async()=>{providerRequests++;throw Error("Do not call provider");}
  });
  const result=await handler({httpMethod:"POST",headers:{authorization:"Bearer editor-test"},
    body:JSON.stringify({id:samplePost.id,reporting:phrase("Additional context",5),reportingUrl:"http://localhost/internal"})});
  assert.equal(result.statusCode,400);
  assert.equal(providerRequests,0);
});
test("expanded research creates a draft without publishing it",async()=>{
  const db=editorialDb(samplePost);let sent=0;
  const handler=loadHandler("curator-expand-article",db,{
    env:{GROQ_API_KEY:"test-key"},
    fetch:async()=>{sent++;return {
      ok:true,status:200,json:async()=>({choices:[{message:{content:JSON.stringify(validResponse())}}]})
    };}
  });
  const result=await handler({httpMethod:"POST",headers:{authorization:"Bearer editor-test"},
    body:JSON.stringify({id:samplePost.id,reporting:phrase("Corroborating facts",5),
      reportingUrl:"https://example.net/independent-report"})});
  assert.equal(result.statusCode,200);
  assert.equal(JSON.parse(result.body).editorialReviewRequired,true);
  assert.equal(db.calls.includes("update"),true);
  assert.equal(sent,1);
});
test("mobile curator header and post cards do not enforce an unbounded minimum width",()=>{
  const source=fs.readFileSync("assets/js/curator-ui.js","utf8");
  const css=fs.readFileSync("assets/css/admin.css","utf8");
  assert.match(source,/\.curator-manager \.manager-header \{grid-template-columns:minmax\(0,1fr\);gap:18px/);
  assert.match(source,/\.curator-manager \.curator-image-preview \{display:block/);
  assert.match(source,/data-curator-reporting-source/);
  assert.match(css,/\.admin-shell \.admin-panel \{\s*display: grid;\s*width: 100%;\s*grid-template-columns: minmax\(0, 1fr\)/);
});
test("post deletion migration cascades comments without deleting data in the migration",()=>{
  const sql=fs.readFileSync("supabase/migrations/20261014260000_cascade_post_comments_on_permanent_delete.sql","utf8");
  assert.match(sql,/foreign key \(post_id\) references public\.posts\(id\)\s+on delete cascade/i);
  assert.doesNotMatch(sql,/delete from public\.comments/i);
});
