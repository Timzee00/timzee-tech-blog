const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const root=path.resolve(__dirname,"..");
const read=name=>fs.readFileSync(path.join(root,name),"utf8");
const source=read("netlify/functions/operations-inbox.js");
const UUID="00000000-0000-4000-8000-000000000001";
function fakeDB({rows=[],count=rows.length,error=null}={}){
 const calls=[];
 const db={
  from(table){
   const call={table,orders:[]};
   calls.push(call);
   const chain={
    select(fields,options){call.fields=fields;call.options=options;return chain;},
    eq(column,value){call.column=column;call.value=value;return chain;},
    order(field,options){call.orders.push({field,ascending:options.ascending});return chain;},
    async range(start,end){call.start=start;call.end=end;return{data:rows,error,count};}
   };
   return chain;
  }
 };
 return{db,calls};
}
function load({db,role="admin",error=null}={}){
 const module={exports:{}};
 const context={console,process};
 const requireStub=id=>{
  if(id==="@supabase/supabase-js")return{createClient:()=>db};
  if(id==="./_lib/auth-role.js")return{requireRole:async(_db,_token,allowed)=>
   error?{error}:allowed.includes(role)?{role,user:{id:UUID}}:{error:"Administrator access required."}};
  throw Error("Unrecognized dependency: "+id);
 };
 vm.runInNewContext("(function(require,module,exports){"+source+"\n})",context)(requireStub,module,module.exports);
 return module.exports;
}
const withEnv=async fn=>{
 const a=process.env.SUPABASE_URL,b=process.env.SUPABASE_SERVICE_ROLE_KEY;
 process.env.SUPABASE_URL="https://example.supabase.co";
 process.env.SUPABASE_SERVICE_ROLE_KEY="never-expose-secret";
 try{return await fn();}finally{
  if(a===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=a;
  if(b===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=b;
 }
};
const event=(kind="reports",page="1")=>({httpMethod:"GET",
 headers:{authorization:"Bearer unit-test-token"},queryStringParameters:{kind,page}});

test("staff-only inbox rejects unknown queues, malformed pages and denied accounts",async()=>{
 const {db,calls}=fakeDB();
 const {handler,_test}=load({db});
 assert.equal(_test.parsePage({kind:"constructor",page:"1"}),null);
 assert.equal(_test.parsePage({kind:"automod",page:"51"}),null);
 assert.equal(_test.parsePage({kind:"reports",page:"01"}),null);
 assert.equal(_test.parsePage({kind:"community",page:"2"}).page,2);
 assert.equal((await handler({httpMethod:"POST",headers:{}})).statusCode,405);
 assert.equal((await handler({httpMethod:"GET",headers:{}})).statusCode,401);
 assert.equal((await handler(event("invalid"))).statusCode,400);
 await withEnv(async()=>{
  assert.equal((await load({db,role:"user"}).handler(event())).statusCode,403);
  assert.equal((await load({db,error:"Invalid auth token."}).handler(event())).statusCode,401);
 });
 assert.equal(calls.length,0);
});

test("server returns only bounded, sanitized staff review data",async()=>{
 const {db,calls}=fakeDB({rows:[{
  id:UUID,reporter_id:"SECRET-REPORTER",content_type:"user",content_id:UUID,
  reason:"<svg onload=alert(1)>"+ "x".repeat(1000),created_at:"2026-10-19T00:00:00Z"
 }],count:17});
 const {handler}=load({db});
 await withEnv(async()=>{
  const result=await handler(event("reports","1"));
  assert.equal(result.statusCode,200);
  const payload=JSON.parse(result.body);
  assert.equal(payload.items.length,1);
  assert.equal(payload.total,17);
  assert.equal(payload.hasMore,true);
  assert.equal(payload.items[0].reason.length,350);
  assert.ok(!result.body.includes("SECRET-REPORTER"));
  assert.ok(!result.body.includes("never-expose-secret"));
  assert.equal(result.headers["Cache-Control"],"private, no-store");
 });
 assert.equal(calls[0].table,"content_reports");
 assert.equal(calls[0].column,"status");
 assert.equal(calls[0].value,"open");
 assert.deepEqual([calls[0].start,calls[0].end],[0,14]);
 assert.ok(!calls[0].fields.includes("reporter_id"));
});

test("queue pagination and risk ordering remain bounded",async()=>{
 const {db,calls}=fakeDB({rows:[{
  id:13,target_type:"reply",target_id:UUID,community_id:UUID,
  signals:["multiple_links","repeated_text"],risk_score:98
 }],count:16});
 const {handler}=load({db});
 await withEnv(async()=>{
  const result=await handler(event("automod","2"));
  const payload=JSON.parse(result.body);
  assert.equal(payload.items[0].riskScore,98);
  assert.equal(payload.items[0].signals[0],"multiple_links");
  assert.equal(payload.items[0].reporterId,undefined);
  assert.equal(payload.hasMore,false);
 });
 assert.deepEqual([calls[0].start,calls[0].end],[15,29]);
 assert.equal(calls[0].orders[0].field,"risk_score");
 assert.equal(calls[0].orders[1].field,"created_at");
});

test("founder review UI uses staff-only endpoint and audited decision RPCs",()=>{
 const client=read("assets/js/operations-triage.mjs");
 const admin=read("assets/js/admin.js");
 const page=read("admin/dashboard.html");
 const css=read("assets/css/operations-console.css");
 assert.match(client,/operations-inbox\?kind=/);
 assert.match(client,/operations-triage/);
 assert.match(client,/content_reports/);
 assert.match(client,/community_review_report/);
 assert.match(client,/community_review_auto_flag/);
 assert.match(client,/requestId:state\.requestKeys\.get\(key\)/);
 assert.doesNotMatch(client,/\.innerHTML\s*=|\.from\("content_reports"\)\.update/);
 assert.match(admin,/mountOperationsTriage\(\)/);
 assert.match(page,/id="operationsTriageList"/);
 assert.match(page,/id="operationsTriageKind"/);
 assert.match(css,/minmax\(min\(100%,280px\),1fr\)/);
});
test("community staff decisions have database-enforced atomic audits and indexes",()=>{
 const sql=read("supabase/migrations/20261019090000_founder_moderation_inbox_audit.sql");
 assert.match(sql,/CREATE INDEX IF NOT EXISTS community_reports_pending_triage_idx/);
 assert.match(sql,/CREATE INDEX IF NOT EXISTS community_auto_moderation_pending_triage_idx/);
 assert.match(sql,/SECURITY DEFINER/);
 assert.match(sql,/v_actor IS DISTINCT FROM auth\.uid\(\)/);
 assert.match(sql,/INSERT INTO public\.moderation_audit/);
 assert.match(sql,/AFTER UPDATE OF status ON public\.community_reports/);
 assert.match(sql,/AFTER UPDATE OF state ON public\.community_auto_moderation/);
});

test("completed moderation reviews are protected from silent subsequent rewrites",()=>{
 const sql=read("supabase/migrations/20261019093000_finalized_community_review_guard.sql");
 assert.match(sql,/OLD\.status<>'pending'/);
 assert.match(sql,/OLD\.state<>'pending'/);
 assert.match(sql,/BEFORE UPDATE OF status ON public\.community_reports/);
 assert.match(sql,/BEFORE UPDATE OF state ON public\.community_auto_moderation/);
 assert.match(sql,/REVOKE ALL ON FUNCTION private\.guard_finalized_community_review/);
});
