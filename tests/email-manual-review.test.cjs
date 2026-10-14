const test=require("node:test");
const assert=require("node:assert/strict");
const {loadHandler}=require("./helpers.cjs");

const validJob="2b984c39-3056-47c8-bbc1-58b9012efaf1";
function client(role,calls){
  return {
    auth:{getUser:async()=>({data:{user:{id:"00000000-0000-4000-8000-000000000001"}},error:null})},
    from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{role,account_status:"active"},error:null})})})}),
    rpc:async(name,args)=>{calls.push({name,args});
      if(name==="list_email_review_cases")return {data:[],error:null};
      if(name==="record_email_review_action")return {data:{decision:args.p_decision,sent:false},error:null};
      if(name==="email_delivery_statistics")return {data:{failed:0},error:null};
      throw Error("Unexpected RPC "+name);
    }
  };
}
const auth={authorization:"Bearer test-admin-token"};
const request=(body,headers=auth)=>({httpMethod:"POST",headers,body:JSON.stringify(body)});
const valid={job_id:validJob,decision:"needs_investigation",note:"Checked provider logs; awaiting confirmation."};
test("review queue is restricted to authenticated super admin",async()=>{
  const calls=[];
  const user=loadHandler("email-operations",client("user",calls));
  const noAuth=await user({httpMethod:"GET",headers:{},queryStringParameters:{review:"1"}});
  const denied=await user({httpMethod:"GET",headers:auth,queryStringParameters:{review:"1"}});
  assert.equal(noAuth.statusCode,401);assert.equal(denied.statusCode,403);
  assert.equal(calls.length,0);
});
test("super-admin review list never exposes recipient emails",async()=>{
  const calls=[];const admin=loadHandler("email-operations",client("super",calls));
  const response=await admin({httpMethod:"GET",headers:auth,queryStringParameters:{review:"1"}});
  assert.equal(response.statusCode,200);assert.deepEqual(calls.map(x=>x.name),["list_email_review_cases"]);
  assert.equal(response.body.includes("recipient_email"),false);
});
test("review write records actor and never sends email",async()=>{
  const calls=[];let networkRequests=0;
  const admin=loadHandler("email-operations",client("super",calls),{fetch:()=>{networkRequests++;}});
  const response=await admin(request(valid));
  assert.equal(response.statusCode,200);assert.equal(JSON.parse(response.body).email_sent,false);
  assert.equal(calls.length,1);assert.equal(calls[0].name,"record_email_review_action");
  assert.equal(calls[0].args.p_job_id,validJob);
  assert.equal(calls[0].args.p_actor_id,"00000000-0000-4000-8000-000000000001");
  assert.equal(networkRequests,0);
});
test("review endpoint rejects malformed JSON and invalid decisions",async()=>{
  const calls=[];const admin=loadHandler("email-operations",client("super",calls));
  assert.equal((await admin({httpMethod:"POST",headers:auth,body:"{"})).statusCode,400);
  assert.equal((await admin(request({...valid,decision:"retry"}))).statusCode,400);
  assert.equal((await admin(request({...valid,note:"too short"}))).statusCode,400);
  assert.equal(calls.length,0);
});
test("non-admin review submissions do not reach service-role RPC",async()=>{
  const calls=[];const user=loadHandler("email-operations",client("user",calls));
  const response=await user(request(valid));
  assert.equal(response.statusCode,403);assert.equal(calls.length,0);
});

test("case list strips recipient addresses embedded in provider errors",async()=>{
  const calls=[];
  const db=client("super",calls);
  db.rpc=async(name,args)=>{
    calls.push({name,args});
    return {data:[{id:validJob,template:"contact_received",
      reason:"Address member@example.test rejected",recipient_email:"member@example.test",
      payload:{secret:"not for client"}}],error:null};
  };
  const handler=loadHandler("email-operations",db);
  const result=await handler({httpMethod:"GET",headers:auth,queryStringParameters:{review:"1"}});
  assert.equal(result.statusCode,200);
  assert.match(result.body,/\[redacted email\]/);
  assert.equal(result.body.includes("member@example.test"),false);
  assert.equal(result.body.includes("recipient_email"),false);
  assert.equal(result.body.includes("not for client"),false);
});
