const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const code=read("netlify/functions/moderate-content.js");
const schema=read("supabase/migrations/20261019021000_atomic_moderation_actions.sql");
const UUID="11111111-1111-4111-8111-111111111111";
const ITEM="22222222-2222-4222-8222-222222222222";
const KEY="33333333-3333-4333-8333-333333333333";

function setup({role="admin",rpcData={ok:true,auditId:82,replayed:false},rpcError=null}={}){
 const calls=[];
 const db={
  rpc:async(name,args)=>{calls.push({name,args});return {data:rpcData,error:rpcError};}
 };
 const module={exports:{}};
 const dependencies={
  "node:crypto":{randomUUID:()=>KEY},
  "./_lib/request.js":{parseJsonObject:event=>({payload:JSON.parse(event.body||"{}")})},
  "@supabase/supabase-js":{createClient:()=>db},
  "./_lib/auth-role.js":{requireRole:async(_db,_token,roles)=>role==="user"
    ?{error:"Moderator permission required."}
    :{user:{id:UUID},role}}
 };
 const fn=vm.runInNewContext("(function(require,module,exports){"+code+"\n})",{console,process}, {timeout:1000});
 fn(name=>{if(!Object.hasOwn(dependencies,name))throw Error(name);return dependencies[name];},module,module.exports);
 const event=(payload,{token=true,method="POST"}={})=>({
  httpMethod:method,headers:token?{authorization:"Bearer fake-access-token"}:{},
  body:JSON.stringify(payload)
 });
 return {handler:module.exports.handler,parseAction:module.exports._test.parseAction,calls,event};
}
test("moderation cannot run without a token or valid supported action",async()=>{
 const s=setup();
 assert.equal((await s.handler(s.event({}, {method:"GET"}))).statusCode,405);
 assert.equal((await s.handler(s.event({}, {token:false}))).statusCode,401);
 assert.equal((await s.handler(s.event({type:"posts",action:"delete",id:"invalid"}))).statusCode,400);
 assert.equal((await s.handler(s.event({type:"profiles",action:"delete",id:ITEM}))).statusCode,400);
 assert.equal(s.calls.length,0);
});
test("role restrictions apply before mutation",async()=>{
 const s=setup({role:"user"});
 const old=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL="https://example.supabase.co";process.env.SUPABASE_SERVICE_ROLE_KEY="test-only-key";
 try{
  const response=await s.handler(s.event({type:"posts",action:"unpublish",id:ITEM}));
  assert.equal(response.statusCode,403);
  assert.equal(s.calls.length,0);
 }finally{
  if(old===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=old;
  if(key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=key;
 }
});
test("staff mutation returns success only when RPC confirms an audit entry",async()=>{
 const s=setup();
 const old=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL="https://example.supabase.co";process.env.SUPABASE_SERVICE_ROLE_KEY="test-only-key";
 try{
  const request=s.event({type:"posts",action:"unpublish",id:ITEM,requestId:KEY});
  const res=await s.handler(request);
  assert.equal(res.statusCode,200);
  assert.equal(JSON.parse(res.body).auditId,82);
  assert.equal(s.calls.length,1);
  assert.equal(s.calls[0].name,"moderate_content_transactional");
  assert.equal(s.calls[0].args.p_actor,UUID);
  assert.equal(s.calls[0].args.p_content_id,ITEM);
  assert.equal(s.calls[0].args.p_request_id,KEY);
  const incomplete=setup({rpcData:{ok:true}});
  assert.equal((await incomplete.handler(request)).statusCode,503);
  const denied=setup({rpcError:{code:"42501"}});
  assert.equal((await denied.handler(request)).statusCode,403);
 }finally{
  if(old===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=old;
  if(key===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=key;
 }
});
test("moderation RPC enforces an atomic audit and restrictive grants",()=>{
 assert.match(schema,/INSERT INTO public\.moderation_audit/);
 assert.match(schema,/UPDATE public\.posts/);
 assert.match(schema,/pg_advisory_xact_lock/);
 assert.match(schema,/moderation_audit_request_id_unique/);
 assert.match(schema,/REVOKE ALL ON FUNCTION public\.moderate_content_transactional/);
 assert.match(schema,/GRANT EXECUTE ON FUNCTION public\.moderate_content_transactional/);
 assert.match(schema,/account_status='active'/);
 assert.doesNotMatch(code,/\.from\(definition\.table\)|\.from\("moderation_audit"\)/);
});

test("report decisions must use the shared audited moderation endpoint",()=>{
 const moderator=read("assets/js/moderator-panel.js");
 const endpoint=read("netlify/functions/moderate-content.js");
 const reportMigration=read("supabase/migrations/20261019023000_audited_report_resolution.sql");
 assert.match(moderator,/mountReportInvestigator/);
 assert.match(read("assets/js/moderation-case-ui.mjs"),/staff|evidence|Investigation/);
 assert.match(read("netlify/functions/moderation-cases.js"),/staff_decide_content_report/);
 assert.doesNotMatch(moderator,/from\("content_reports"\)\.update\(/);
 assert.doesNotMatch(endpoint,/content_reports:\["resolve","dismiss"\]/);
 assert.match(read("netlify/functions/moderation-cases.js"),/staff_decide_content_report/);
 assert.match(reportMigration,/status='open' RETURNING id INTO v_changed/);
 assert.doesNotMatch(reportMigration,/WHEN 'content_reports' THEN 'content_reports'[\s\S]*?IF p_action='delete' THEN/);
});
