const test=require("node:test");
const assert=require("node:assert/strict");
const {loadHandler}=require("./helpers.cjs");

function dbForRole(role){
  return {
    auth:{getUser:async()=>({data:{user:{id:"00000000-0000-4000-8000-000000000001",app_metadata:{role}}},error:null})},
    from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{role},error:null})})})}),
    rpc:async()=>({data:{pending:0,failed:0,sent:0},error:null})
  };
}
const baseEnv={SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"test-only",BREVO_API_KEY:"test-only"};
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
test("provider verifier uses read-only Brevo GET without exposing key",async()=>{
  let contacted=false;
  const handler=loadHandler("email-operations",dbForRole("super"),{env:baseEnv,fetch:async (url,options)=>{
    contacted=true;assert.equal(url,"https://api.brevo.com/v3/account");
    assert.equal(options?.method,undefined);assert.equal(options.headers["api-key"],"test-only");
    return {ok:true,status:200};
  }});
  const response=await handler(request);
  assert.equal(response.statusCode,200);assert.equal(contacted,true);
  assert.equal(JSON.parse(response.body).authenticated,true);
  assert.equal(response.body.includes("test-only"),false);
});
