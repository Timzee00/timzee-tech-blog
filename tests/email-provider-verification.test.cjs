const test=require("node:test");
const assert=require("node:assert/strict");
const {loadHandler}=require("./helpers.cjs");

function dbForRole(role){
  return {
    auth:{getUser:async()=>({data:{user:{id:"00000000-0000-4000-8000-000000000001",app_metadata:{role}}},error:null})},
    from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{role,account_status:"active"},error:null})})})}),
    rpc:async()=>({data:{pending:0,failed:0,sent:0},error:null})
  };
}
const baseEnv={SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"test-only",BREVO_API_KEY:"test-only",BREVO_SENDER_EMAIL:"verified@example.org"};
const request={httpMethod:"GET",headers:{authorization:"Bearer mock-token"},queryStringParameters:{verifyProvider:"1"}};

test("unauthenticated email operations cannot reach Brevo",async()=>{
  let contacted=false;
  const handler=loadHandler("email-operations",dbForRole("super"),{env:baseEnv,fetch:()=>{contacted=true;}});
  const response=await handler({httpMethod:"GET",headers:{},queryStringParameters:{verifyProvider:"1"}});
  assert.equal(response.statusCode,401);assert.equal(contacted,false);
});
test("ordinary members cannot test privileged provider credentials",async()=>{
  let contacted=false;
  const handler=loadHandler("email-operations",dbForRole("user"),{env:baseEnv,fetch:()=>{contacted=true;}});
  const response=await handler(request);
  assert.equal(response.statusCode,403);assert.equal(contacted,false);
});
test("provider verifier checks both the account and the configured verified sender",async()=>{
  const urls=[];
  const handler=loadHandler("email-operations",dbForRole("super"),{env:baseEnv,fetch:async(url,options)=>{
    urls.push(url);
    assert.equal(options?.method,undefined);
    assert.equal(options.headers["api-key"],"test-only");
    if(url.endsWith("/account"))return {ok:true,status:200};
    return {ok:true,status:200,json:async()=>({senders:[{email:"verified@example.org",active:true}]})};
  }});
  const response=await handler(request);
  assert.equal(response.statusCode,200);
  assert.equal(JSON.parse(response.body).authenticated,true);
  assert.equal(JSON.parse(response.body).sender_verified,true);
  assert.deepEqual(urls,["https://api.brevo.com/v3/account","https://api.brevo.com/v3/senders"]);
  assert.equal(response.body.includes("test-only"),false);
});
test("provider verifier flags unverified senders without sending a test email",async()=>{
  const handler=loadHandler("email-operations",dbForRole("super"),{env:baseEnv,fetch:async(url)=>url.endsWith("/account")?
    {ok:true,status:200}:{ok:true,status:200,json:async()=>({senders:[]})}});
  const result=JSON.parse((await handler(request)).body);
  assert.equal(result.authenticated,true);
  assert.equal(result.sender_verified,false);
});

