const test=require("node:test");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const fs=require("node:fs");
const path=require("node:path");
const source=fs.readFileSync(path.join(__dirname,"../netlify/functions/verification-review.js"),"utf8");
const USER="11111111-1111-4111-8111-111111111111";
const OTHER="22222222-2222-4222-8222-222222222222";
const FILE="33333333-3333-4333-8333-333333333333";
const APP="44444444-4444-4444-8444-444444444444";

function setup({proofPath=USER+"/"+FILE+".pdf",rowCount=26}={}){
  const calls={signed:0};
  const row={id:APP,user_id:USER,documents:[{path:proofPath,type:"application/pdf"}]};
  const db={
    from(table){
      assert.equal(table,"verification_applications");
      return{select(_columns,options={}){
        return{eq(_field,_value){
          return{
            maybeSingle:async()=>({data:row,error:null}),
            order:()=>({range:async()=>({data:[row],count:options.count==="exact"?rowCount:null,error:null})})
          };
        }};
      }};
    },
    storage:{from(bucket){
      assert.equal(bucket,"verification-proofs");
      return{createSignedUrl:async(_path,seconds)=>{
        calls.signed++;
        assert.equal(seconds,120);
        return{data:{signedUrl:"https://example.test/signed-proof"},error:null};
      }};
    }}
  };
  const module={exports:{}};
  const requireStub=id=>{
    if(id==="@supabase/supabase-js")return{createClient:()=>db};
    if(id==="./_lib/auth-role.js")return{
      requireRole:async()=>({user:{id:OTHER},role:"admin"})
    };
    if(id==="./_lib/request.js")return{parseJsonObject:()=>({payload:{}})};
    throw Error("Unexpected require "+id);
  };
  vm.runInNewContext("(function(require,module,exports,process){"+source+"\n})",
    {},{timeout:2000})(requireStub,module,module.exports,{env:{
      SUPABASE_URL:"https://example.test",
      SUPABASE_SERVICE_ROLE_KEY:"unit-test-only"
    }});
  const request=queryStringParameters=>module.exports.handler({
    httpMethod:"GET",headers:{authorization:"Bearer test"},queryStringParameters
  });
  return{request,calls};
}

test("verification queue counts all pending applications before paging",async()=>{
  const{request}=setup({rowCount:26});
  const response=await request({page:"1"});
  assert.equal(response.statusCode,200);
  const data=JSON.parse(response.body);
  assert.equal(data.hasMore,true);
  assert.equal(data.page,1);
  assert.equal(data.applications.length,1);
  assert.equal("path" in data.applications[0].documents[0],false);
});

test("verification reviewer cannot sign another account's proof path",async()=>{
  const{request,calls}=setup({proofPath:OTHER+"/"+FILE+".pdf"});
  const response=await request({applicationId:APP,proofIndex:"0"});
  assert.equal(response.statusCode,404);
  assert.equal(calls.signed,0);
});

test("verification proof signing requires an exact generated file path",async()=>{
  for(const proofPath of [USER+"/../"+FILE+".pdf",
    USER+"/"+FILE+".exe",USER+"/"+FILE+".pdf/extra",
    "https://evil.invalid/"+FILE+".pdf"]){
    const{request,calls}=setup({proofPath});
    const response=await request({applicationId:APP,proofIndex:"0"});
    assert.equal(response.statusCode,404);
    assert.equal(calls.signed,0);
  }
});

test("authorized reviewer can sign a correctly owned proof for two minutes",async()=>{
  const{request,calls}=setup();
  const response=await request({applicationId:APP,proofIndex:"0"});
  assert.equal(response.statusCode,200);
  assert.equal(JSON.parse(response.body).expires_in_seconds,120);
  assert.equal(calls.signed,1);
});
