const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

const root=path.resolve(__dirname,"..");
const source=fs.readFileSync(path.join(root,"netlify/functions/operations-overview.js"),"utf8");
const html=fs.readFileSync(path.join(root,"admin/dashboard.html"),"utf8");
const client=fs.readFileSync(path.join(root,"assets/js/operations-console.mjs"),"utf8");
const css=fs.readFileSync(path.join(root,"assets/css/operations-console.css"),"utf8");

function loadModule({db,role="admin",error=null}={}){
  const module={exports:{}};
  const requested=[];
  const requireStub=id=>{
    if(id==="@supabase/supabase-js")return {createClient:(url,key)=>{
      requested.push({url,key});
      return db;
    }};
    if(id==="./_lib/auth-role.js")return {requireRole:async(_db,_token,roles)=>{
      if(error)return{error};
      return roles.includes(role)?{role,user:{id:"test-user"}}:{error:"Administrator permission required."};
    }};
    throw Error("Unexpected require: "+id);
  };
  vm.runInNewContext("(function(require,module,exports){"+source+"\n})",{}, {timeout:1000})(requireStub,module,module.exports);
  return {handler:module.exports.handler,helpers:module.exports._test,requested};
}
function fakeDB({counts={},jobs=[],audit=[],failCount=null,failedAudit=false}={}){
  return {
    from(table){
      return {
        select(_columns,_options){
          return {
            eq(column,value){
              if(table===failCount)return Promise.resolve({count:null,error:{message:"Unavailable"}});
              return Promise.resolve({count:counts[table]??0,error:null});
            },
            in(column,values){
              assert.equal(table,"system_job_status");
              return{limit:async()=>({data:jobs,error:null})};
            },
            order(){
              assert.equal(table,"moderation_audit");
              return{limit:async()=>failedAudit?{data:null,error:{message:"No access"}}:{data:audit,error:null}};
            }
          };
        }
      };
    }
  };
}
const event={httpMethod:"GET",headers:{authorization:"Bearer test-token"}};

test("overview distinguishes work backlog, stale jobs and missing metrics",async()=>{
  const db=fakeDB({counts:{
    verification_applications:3,content_reports:2,community_reports:0,
    community_auto_moderation:1,posts:9
  },failCount:"community_reports",
  jobs:[{job_name:"automation-maintenance",last_succeeded_at:"2026-10-16T19:05:14Z",last_failed_at:null}],
  audit:[{action:"resolve_report",content_type:"post",created_at:"2026-10-18T12:00:00Z"}]});
  const {helpers}=loadModule({db});
  const result=await helpers.overview(db,Date.parse("2026-10-19T00:00:00Z"));
  assert.equal(result.queues.verification,3);
  assert.equal(result.queues.scheduledPosts,9);
  assert.equal(result.queues.communityReports,null);
  assert.equal(result.jobs[0].state,"stale");
  assert.equal(result.jobs[1].state,"stale");
  assert.match(result.issues.join(" "),/3 pending verification/);
  assert.match(result.issues.join(" "),/communityReports metric unavailable/);
  assert.equal(result.summary,"attention");
  assert.equal(result.audit.length,1);
});

test("operations endpoint rejects unauthenticated and unauthorized requests",async()=>{
  const db=fakeDB();
  const {handler,requested}=loadModule({db});
  const noAuth=await handler({httpMethod:"GET",headers:{}});
  assert.equal(noAuth.statusCode,401);
  assert.equal(requested.length,0);
  const method=await handler({httpMethod:"POST",headers:{}});
  assert.equal(method.statusCode,405);
  const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL="https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY="unit-test-only-secret";
  try{
    const unauthorized=loadModule({db,role:"user"});
    const denied=await unauthorized.handler(event);
    assert.equal(denied.statusCode,403);
  }finally{
    if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
    if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
  }
});

test("operations response includes only read-only aggregates and safe audit summaries",async()=>{
  const db=fakeDB({counts:{content_reports:2},audit:[{action:"reviewed",content_type:"thread",created_at:"2026-10-18T00:00:00Z"}]});
  const {handler}=loadModule({db});
  const oldUrl=process.env.SUPABASE_URL,oldKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_URL="https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY="unit-test-only-secret";
  try{
    const response=await handler(event);
    const data=JSON.parse(response.body);
    assert.equal(response.statusCode,200);
    assert.equal(data.queues.reports,2);
    assert.equal(data.audit[0].content_type,"thread");
    assert.ok(!response.body.includes("unit-test-only-secret"));
    assert.equal(response.headers["Cache-Control"],"private, no-store");
    assert.match(data.issues.join(" "),/pending reports/);
  }finally{
    if(oldUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=oldUrl;
    if(oldKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=oldKey;
  }
});

test("stale/failed job status uses last success, not the run count",()=>{
  const {helpers}=loadModule();
  const now=Date.parse("2026-10-19T00:00:00Z");
  const healthy=helpers.describeJob({job_name:"automation-maintenance",last_succeeded_at:"2026-10-18T23:50:00Z"},now);
  const failed=helpers.describeJob({job_name:"automation-maintenance",last_succeeded_at:"2026-10-18T23:50:00Z",last_failed_at:"2026-10-18T23:55:00Z"},now);
  assert.equal(healthy.state,"healthy");
  assert.equal(failed.state,"failed");
});

test("operations UI is role-gated, responsive and avoids client-owned DB secrets",()=>{
  assert.match(html,/data-tab="operations"/);
  assert.match(html,/id="operationsQueues"/);
  assert.match(html,/id="operationsJobs"/);
  assert.match(html,/id="operationsAudit"/);
  assert.match(client,/getSession\(\)/);
  assert.match(client,/operations-overview/);
  assert.match(client,/replaceChildren\(\)/);
  assert.doesNotMatch(client,/innerHTML|SERVICE_ROLE_KEY/);
  assert.match(css,/minmax\(min\(100%,220px\),1fr\)/);
  assert.match(fs.readFileSync(path.join(root,"assets/js/moderator-panel.js"),"utf8"),/URLSearchParams\(window.location.search\)/);
});

test("admin skip link and boot error fallback share one unique main id",()=>{
 const markup=fs.readFileSync(path.join(root,"admin/dashboard.html"),"utf8");
 assert.equal((markup.match(/id="adminApp"/g)||[]).length,1);
 assert.match(markup,/href="#adminApp"/);
 assert.doesNotMatch(markup,/<main[^>]*\bid="[^"]+"[^>]*\bid="[^"]+"/i);
});
