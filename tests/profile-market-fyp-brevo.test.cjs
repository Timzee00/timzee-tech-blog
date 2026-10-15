const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {loadHandler}=require("./helpers.cjs");
const source=p=>fs.readFileSync(p,"utf8");

test("staff Brevo reply is disabled until both independent sending gates are enabled",async()=>{
  let dbCalls=0;
  const db={rpc:async()=>{dbCalls++;throw Error("should stay paused");}};
  const handler=loadHandler("admin-reply-email",db);
  const response=await handler({httpMethod:"POST",body:"{}"});
  assert.equal(response.statusCode,503);
  assert.match(response.body,/paused/);
  assert.equal(dbCalls,0);
});
test("anonymous staff cannot send via the reply endpoint",async()=>{
  const handler=loadHandler("admin-reply-email",{},{
    env:{EMAIL_DELIVERY_ENABLED:"true",EMAIL_REPLY_ENABLED:"true",
      BREVO_API_KEY:"fake",BREVO_SENDER_EMAIL:"staff@example.test"}});
  const response=await handler({httpMethod:"POST",body:"{}",headers:{}});
  assert.equal(response.statusCode,401);
});
test("reply recipient comes from original request, not untrusted browser payload",()=>{
  const src=source("netlify/functions/admin-reply-email.js");
  const sql=source("supabase/migrations/20261015024500_audited_staff_email_replies.sql");
  assert.match(src,/claim_staff_email_reply/);
  assert.match(src,/recipient=claim\.data\.recipient/);
  assert.doesNotMatch(src,/recipient=data\.email/);
  assert.match(sql,/where id=p_request_id/);
  assert.match(sql,/unique\(actor_id,client_request_id\)/);
  assert.match(sql,/private\.email_suppressions/);
  assert.match(sql,/count24>=40/);
  assert.match(sql,/count24>=5/);
});
test("email dashboard exposes meaningful diagnostic errors for stale deploys",()=>{
  const page=source("super/email-operations.html");
  const handler=source("netlify/functions/email-operations.js");
  assert.match(page,/Email function is missing from this Netlify deploy/);
  assert.match(handler,/diagnostic_code:code/);
  assert.match(handler,/console\.error\("Email operations RPC failed"/);
});
test("profile photos and cover have separate image viewer triggers",()=>{
  const html=source("profile.html"),js=source("assets/js/profile.js");
  assert.match(html,/data-profile-image="cover"/);
  assert.match(html,/data-profile-image="avatar"/);
  assert.match(html,/<dialog id="profileImageDialog"/);
  assert.match(js,/modal\.showModal\(\)/);
  assert.match(js,/plainDisplayName/);
});
test("marketplace offers real seller inquiry and displays mobile-friendly seller identity",()=>{
  const html=source("marketplace.html"),listing=source("listing.html"),css=source("assets/css/marketplace.css");
  assert.match(html,/&contact=1/);
  assert.match(listing,/contactBtn.*click\(\)/);
  assert.match(listing,/contactSellerFeedback/);
  assert.match(css,/\.market-seller-name/);
  assert.match(css,/\.marketplace-grid\{grid-template-columns:minmax\(0,1fr\)/);
});
test("For You video plays inline and posts/videos support real Supabase reactions",()=>{
  const src=source("assets/js/fyp.js"),css=source("assets/css/fyp.css");
  assert.match(src,/<video class="fyp-inline-video"/);
  assert.match(src,/video_url,thumbnail_url,title,is_public/);
  assert.match(src,/post_likes/);
  assert.match(src,/video_likes/);
  assert.match(src,/video_comments/);
  assert.match(src,/\.insert\(payload\)/);
  assert.match(src,/aria-pressed/);
  assert.match(css,/\.fyp-grid\{grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css,/\.fyp-filter-list\{display:flex;flex-wrap:nowrap/);
});
test("no real outbound request is made by a feature-disabled mail handler",async()=>{
  let requests=0;
  const handler=loadHandler("admin-reply-email",{},{
    env:{EMAIL_DELIVERY_ENABLED:"false",EMAIL_REPLY_ENABLED:"true",BREVO_API_KEY:"fake",BREVO_SENDER_EMAIL:"nope@example.test"},
    fetch:()=>{requests++;throw Error("Sending not allowed");}});
  const result=await handler({httpMethod:"POST",body:"{}",headers:{authorization:"Bearer fake"}});
  assert.equal(result.statusCode,503);assert.equal(requests,0);
});

test("authorized Brevo reply uses stored recipient and audits an accepted provider response",async()=>{
  const calls=[];let actualSend=null;
  const db={
    auth:{getUser:async()=>({data:{user:{id:"11111111-1111-4111-8111-111111111111"}},error:null})},
    from(table){
      assert.equal(table,"profiles");
      return {select(){return this},eq(){return this},
        async maybeSingle(){return {data:{role:"super",account_status:"active"},error:null}}};
    },
    rpc:async(name,args)=>{
      calls.push({name,args});
      if(name==="claim_staff_email_reply")
        return {data:{reserved:true,id:"44444444-4444-4444-8444-444444444444",
          recipient:"stored-recipient@example.test"},error:null};
      if(name==="finish_staff_email_reply")return {data:true,error:null};
      throw Error("Unexpected database function "+name);
    }
  };
  const handler=loadHandler("admin-reply-email",db,{
    env:{EMAIL_DELIVERY_ENABLED:"true",EMAIL_REPLY_ENABLED:"true",
      BREVO_API_KEY:"test-only",BREVO_SENDER_EMAIL:"sender@example.test"},
    fetch:async(_url,options)=>{
      actualSend=JSON.parse(options.body);
      return{ok:true,status:201,json:async()=>({messageId:"provider-mock-1"})};
    }
  });
  const response=await handler({httpMethod:"POST",headers:{authorization:"Bearer test-admin"},
    body:JSON.stringify({kind:"contact",request_id:"22222222-2222-4222-8222-222222222222",
      client_request_id:"33333333-3333-4333-8333-333333333333",recipient_email:"attacker@example.test",
      subject:"Re: Your support request",message:"We'll respond shortly."})});
  assert.equal(response.statusCode,200);
  assert.equal(JSON.parse(response.body).provider_accepted,true);
  assert.equal(actualSend.to[0].email,"stored-recipient@example.test");
  assert.equal(actualSend.to[0].email==="attacker@example.test",false);
  assert.equal(calls[1].name,"finish_staff_email_reply");
  assert.equal(calls[1].args.p_status,"accepted");
});
