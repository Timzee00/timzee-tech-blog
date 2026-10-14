const test=require("node:test");
const assert=require("node:assert/strict");
const {loadHandler}=require("./helpers.cjs");
const {readFileSync}=require("node:fs");

test("digest queue uses opted-in categories, confirmed email, active profile and suppression checks",()=>{
  const sql=readFileSync("supabase/migrations/20261014230000_opt_in_digest_preparation.sql","utf8");
  assert.match(sql,/private\.email_digest_controls/);
  assert.match(sql,/enabled boolean not null default false/);
  assert.match(sql,/u\.email_confirmed_at is not null/);
  assert.match(sql,/pr\.account_status='active'/);
  assert.match(sql,/private\.email_suppressions/);
  for(const [kind,flag] of [
    ["message_digest","message_digest"],["mention_digest","mention_digest"],
    ["marketplace_alerts","marketplace_alerts"],["community_digest","community_digest"]
  ])assert.ok(sql.includes("n.kind='"+kind+"' and p."+flag));
  assert.match(sql,/if p_dry_run then/);
  assert.match(sql,/on conflict\(event_key\) do nothing/);
  assert.match(sql,/revoke all on function public.prepare_email_digests/);
});
test("daily preparer stays disabled unless BOTH Netlify switches are on",async()=>{
  let calls=0;
  const db={rpc:async()=>{calls++;throw Error("DB should never be contacted");}};
  const handler=loadHandler("email-digest-preparer",db);
  const disabled=await handler();
  assert.equal(disabled.statusCode,200);
  assert.match(disabled.body,/paused/i);
  assert.equal(calls,0);
  const partial=loadHandler("email-digest-preparer",db,{env:{EMAIL_DELIVERY_ENABLED:"true"}});
  const result=await partial();
  assert.equal(result.statusCode,200);assert.equal(calls,0);
});
test("daily preparer calls service-only queue function only when both gates enabled",async()=>{
  const calls=[];
  const handler=loadHandler("email-digest-preparer",{
    rpc:async(name,args)=>{calls.push({name,args});return{data:{enabled:false,eligible:3,enqueued:0},error:null};}
  },{env:{EMAIL_DELIVERY_ENABLED:"true",EMAIL_DIGEST_ENABLED:"true"}});
  const output=await handler();
  assert.equal(output.statusCode,200);
  assert.deepEqual(calls.map(x=>x.name),["prepare_email_digests"]);
  assert.equal(calls[0].args.p_dry_run,false);
  assert.equal(calls[0].args.p_limit,10);
  assert.equal(JSON.parse(output.body).enqueued,0);
});
test("digest template never includes notification contents, only a count and preferences link",async()=>{
  let body;
  const sample={id:"2b984c39-3056-47c8-bbc1-58b9012efaf1",recipient_email:"user@example.test",template:"mention_digest",payload:{count:4,private_content:"NEVER INCLUDE THIS"}};
  const handler=loadHandler("email-worker",{
    rpc:async(name)=>{
      if(name==="email_delivery_statistics")return{data:{sent_last_24h:0},error:null};
      if(name==="claim_email_jobs")return{data:[sample],error:null};
      if(name==="is_email_suppressed")return{data:false,error:null};
      if(name==="complete_email_job")return{data:null,error:null};
      throw Error("Unexpected DB RPC "+name);
    }
  },{
    env:{EMAIL_DELIVERY_ENABLED:"true",BREVO_API_KEY:"test",BREVO_SENDER_EMAIL:"sender@example.test"},
    fetch:async(_url,options)=>{body=JSON.parse(options.body);return{ok:true,status:201,json:async()=>({messageId:"brevo-mock-id"})};}
  });
  const result=await handler();
  assert.equal(result.statusCode,200);
  assert.match(body.htmlContent,/4 unread updates/);
  assert.match(body.htmlContent,/Manage email preferences/);
  assert.equal(body.htmlContent.includes("NEVER INCLUDE THIS"),false);
  assert.equal(body.textContent.includes("NEVER INCLUDE THIS"),false);
});
test("digest preview only runs in dry-run mode and never calls Brevo",async()=>{
  const source=readFileSync("netlify/functions/email-operations.js","utf8");
  assert.match(source,/p_dry_run:true/);
  assert.match(source,/digestPreview/);
  assert.match(source,/enqueued:0/);
});
