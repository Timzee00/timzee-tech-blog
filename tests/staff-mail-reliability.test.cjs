const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const {loadHandler}=require("./helpers.cjs");
const {buildStaffReplyEmail}=require("../netlify/functions/_lib/staff-email-template.js");
const source=p=>fs.readFileSync(p,"utf8");
const id="33333333-3333-4333-8333-333333333333";

test("Timzee Corp-inspired email template escapes untrusted sender names and body",()=>{
 const payload=buildStaffReplyEmail({name:'<img src=x onerror=alert(1)>',
   message:'<script>alert("hello")</script>\nWe can help.',requestKind:"support"});
 assert.match(payload.htmlContent.replace(/<[^>]*>/g,""),/Blipmood/);
 assert.doesNotMatch(payload.htmlContent,/<script>|<img src=x/i);
 assert.match(payload.htmlContent,/&lt;script&gt;/);
 assert.doesNotMatch(payload.htmlContent,/onerror=alert\(1\)/);
 assert.match(payload.textContent,/We can help/);
 assert.match(payload.htmlContent,/white-space:pre-wrap/);
});

test("staff reply GET status is read-only and works with disabled sending gates",async()=>{
 const calls=[];
 const db={
   auth:{getUser:async()=>({data:{user:{id:"11111111-1111-4111-8111-111111111111"}},error:null})},
   from(table){if(table!=="profiles")throw Error("Unexpected table "+table);
     return {select(){return this},eq(){return this},
       async maybeSingle(){return {data:{role:"admin",account_status:"active"},error:null}}}},
   async rpc(name,opts){
     calls.push({name,opts});
     if(name!=="get_staff_email_reply_status")throw Error("Unexpected write");
     return {data:{status:"accepted",provider_accepted:true},error:null};
   }
 };
 const handler=loadHandler("admin-reply-email",db,{
   env:{EMAIL_DELIVERY_ENABLED:"false",EMAIL_REPLY_ENABLED:"false",
     BREVO_API_KEY:"test-only",BREVO_SENDER_EMAIL:"sender@example.test"},
   fetch:()=>{throw Error("GET must never send mail")}
 });
 const response=await handler({httpMethod:"GET",headers:{authorization:"Bearer test-admin"},
   queryStringParameters:{id}});
 assert.equal(response.statusCode,200);
 assert.equal(JSON.parse(response.body).reply.status,"accepted");
 assert.equal(calls.length,1);
 assert.equal(calls[0].name,"get_staff_email_reply_status");
});

test("GET status refuses unauthenticated callers and invalid request identifiers",async()=>{
 const db={auth:{getUser:async()=>({data:{user:{id:"11111111-1111-4111-8111-111111111111"}},error:null})},
 from(){return {select(){return this},eq(){return this},
   async maybeSingle(){return{data:{role:"super",account_status:"active"},error:null}}}}};
 const handler=loadHandler("admin-reply-email",db,{env:{EMAIL_DELIVERY_ENABLED:"false"}});
 let response=await handler({httpMethod:"GET",headers:{},queryStringParameters:{id}});
 assert.equal(response.statusCode,401);
 response=await handler({httpMethod:"GET",headers:{authorization:"Bearer staff"},queryStringParameters:{id:"not-a-uuid"}});
 assert.equal(response.statusCode,400);
});

test("browser reuses a stable request id and requests audit status before retry",()=>{
 const admin=source("assets/js/admin.js"),client=source("assets/js/staff-mail-client.mjs");
 assert.match(admin,/sessionStorage\.setItem\(key,clientRequestId\)/);
 assert.match(admin,/checkStaffReply\(clientRequestId\)/);
 assert.match(admin,/send\.disabled=true;send\.textContent="Check status first"/);
 assert.match(client,/getSession/);
 assert.match(client,/\/\.netlify\/functions\/admin-reply-email/);
 assert.doesNotMatch(client,/BREVO_API_KEY|SUPABASE_SERVICE_ROLE_KEY/);
});

test("review status lookup is service-only and exposes no message content",()=>{
 const sql=source("supabase/migrations/20261015031500_staff_reply_status_lookup.sql");
 assert.match(sql,/current_setting\('request\.jwt\.claim\.role',true\) is distinct from 'service_role'/);
 assert.match(sql,/revoke all on function public\.get_staff_email_reply_status/);
 assert.match(sql,/grant execute on function public\.get_staff_email_reply_status.*to service_role/);
 assert.doesNotMatch(sql,/r\.message|r\.recipient_email/);
});

test("sending remains disabled without BOTH delivery switches",async()=>{
 let sends=0;
 const handler=loadHandler("admin-reply-email",{},{
   env:{EMAIL_DELIVERY_ENABLED:"true",EMAIL_REPLY_ENABLED:"false",
     BREVO_API_KEY:"test-only",BREVO_SENDER_EMAIL:"sender@example.test"},
   fetch:()=>{sends++;throw Error("Would have sent mail")}
 });
 const res=await handler({httpMethod:"POST",headers:{authorization:"Bearer test"},body:"{}"});
 assert.equal(res.statusCode,503);
 assert.equal(sends,0);
});
