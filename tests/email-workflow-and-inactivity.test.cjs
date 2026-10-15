const test=require("node:test");
const assert=require("node:assert/strict");
const {createInactivityToken,verifyInactivityToken}=require("../netlify/functions/_lib/email-opt-out-token.js");
const {loadHandler}=require("./helpers.cjs");
const {readFileSync}=require("node:fs");
process.env.EMAIL_UNSUBSCRIBE_SECRET="test-only-secret-do-not-reuse-73f2bb8cceaa9d4d0a8dbf31a";
const user="11111111-1111-4111-8111-111111111111";
const jobId="2b984c39-3056-47c8-bbc1-58b9012efaf1";
const visit="2026-08-01T08:00:00.000Z";
const job={id:jobId,template:"inactivity_reminder",recipient_email:"member@example.test",payload:{user_id:user,last_seen_at:visit}};
test("signed unsubscribe token is scoped to member/job and rejects tampering",()=>{
  const token=createInactivityToken(job);
  assert.deepEqual(verifyInactivityToken(token),{jobId,userId:user});
  assert.equal(verifyInactivityToken(token.slice(0,-1)+"Z"),null);
  assert.equal(verifyInactivityToken("bad"),null);
});
test("inactivity consent defaults off and requires active visits/explicit opt-in",()=>{
  const sql=readFileSync("supabase/migrations/20261014243000_opt_in_inactivity_reminders.sql","utf8");
  assert.match(sql,/inactivity_reminders boolean not null default false/);
  assert.match(sql,/enabled boolean not null default false/);
  assert.match(sql,/inactive_after_days integer not null default 30/);
  assert.match(sql,/p.inactivity_reminders=true/);
  assert.match(sql,/last_reminded_visit_at/);
  assert.match(sql,/p_dry_run/);
  assert.match(sql,/email_confirmed_at is not null/);
});
test("inactivity scheduler never queues without both feature flags",async()=>{
  let rpcCalls=0;
  const handler=loadHandler("email-inactivity-preparer",{rpc:async()=>{rpcCalls++;throw Error("Should remain paused");}});
  const response=await handler();
  assert.equal(response.statusCode,200);assert.equal(rpcCalls,0);
});
test("inactivity scheduler uses dry-run false only when explicitly enabled",async()=>{
  let rpcArgs;
  const handler=loadHandler("email-inactivity-preparer",{rpc:async(name,args)=>{
    assert.equal(name,"prepare_inactivity_reminders");rpcArgs=args;
    return {data:{enabled:false,eligible:0,enqueued:0},error:null};
  }},{env:{EMAIL_DELIVERY_ENABLED:"true",EMAIL_INACTIVITY_ENABLED:"true"}});
  const response=await handler();
  assert.equal(response.statusCode,200);
  assert.deepEqual(JSON.parse(JSON.stringify(rpcArgs)),{p_dry_run:false,p_limit:10});
  assert.equal(JSON.parse(response.body).enqueued,0);
});
test("send-time check stops inactivity mail immediately after member returns",async()=>{
  let networkCalls=0;
  const handler=loadHandler("email-worker",{rpc:async(name)=>{
    if(name==="email_delivery_statistics")return {data:{sent_last_24h:0}};
    if(name==="claim_email_jobs")return {data:[job]};
    if(name==="is_email_suppressed")return {data:false};
    if(name==="can_send_inactivity_reminder")return {data:false};
    if(name==="suppress_email_job")return {data:true};
    throw Error("Unexpected DB RPC "+name);
  }},{env:{EMAIL_DELIVERY_ENABLED:"true",BREVO_API_KEY:"test",BREVO_SENDER_EMAIL:"sender@example.test"},
  fetch:()=>{networkCalls++;throw Error("No email expected");}});
  const response=await handler();
  assert.equal(response.statusCode,200);
  assert.equal(JSON.parse(response.body).suppressed,1);
  assert.equal(networkCalls,0);
});
test("workflow status email suppresses outdated moderator decision",async()=>{
  let sent=false;
  const workflow={id:jobId,template:"verification_status",recipient_email:"member@example.test",payload:{reference:jobId,status:"approved"}};
  const handler=loadHandler("email-worker",{rpc:async(name)=>{
    if(name==="email_delivery_statistics")return {data:{sent_last_24h:0}};
    if(name==="claim_email_jobs")return {data:[workflow]};
    if(name==="is_email_suppressed")return {data:false};
    if(name==="can_send_workflow_status")return {data:false};
    if(name==="suppress_email_job")return {data:true};
    throw Error(name);
  }},{env:{EMAIL_DELIVERY_ENABLED:"true",BREVO_API_KEY:"test",BREVO_SENDER_EMAIL:"sender@example.test"},
  fetch:()=>{sent=true;throw Error("No mail allowed");}});
  const result=await handler();
  assert.equal(JSON.parse(result.body).suppressed,1);assert.equal(sent,false);
});
test("signed unsubscribes are checked against the exact job through service-only RPC",async()=>{
  const token=createInactivityToken(job);let called;
  const handler=loadHandler("email-opt-out",{rpc:async(name,args)=>{
    called={name,args};return{data:true,error:null};
  }});
  const response=await handler({httpMethod:"POST",body:JSON.stringify({token}),headers:{}});
  assert.equal(response.statusCode,200);
  assert.equal(called.name,"opt_out_inactivity_from_email");
  assert.equal(called.args.p_user_id,user);
  assert.equal(called.args.p_job_id,jobId);
});
test("invalid unsubscribe token cannot touch Supabase",async()=>{
  let called=false;
  const handler=loadHandler("email-opt-out",{rpc:async()=>{called=true;}});
  const response=await handler({httpMethod:"POST",body:'{"token":"tampered"}',headers:{}});
  assert.equal(response.statusCode,400);assert.equal(called,false);
});
