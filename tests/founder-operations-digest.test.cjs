const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");

test("founder digest is private, deduplicated, optional and only sent for real work",()=>{
 const sql=read("supabase/migrations/20261019091500_founder_digest_automation.sql");
 assert.match(sql,/PRIMARY KEY\(recipient_id,digest_day\)/);
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/REVOKE ALL ON public\.founder_digest_deliveries FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.process_founder_operations_digest\(\)/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.process_founder_operations_digest\(\) TO service_role/);
 assert.match(sql,/IF auth\.uid\(\) IS NOT NULL THEN/);
 assert.match(sql,/p\.role='super' AND p\.account_status='active'/);
 assert.match(sql,/notifications,operationsDigest/);
 assert.match(sql,/ON CONFLICT DO NOTHING RETURNING true/);
 assert.match(sql,/v_reports\+v_community\+v_flags\+v_verification\+v_overdue\)=0/);
 assert.match(sql,/IF \(now\(\) AT TIME ZONE 'UTC'\)::time < time '08:00'/);
 assert.doesNotMatch(sql,/SELECT \* FROM public\.profiles|SELECT .*documents/);
});

test("founder opt-out is included in supported settings and visible only to super admins",()=>{
 const prefs=read("assets/js/user-preferences.js");
 const settings=read("assets/js/settings-page.js");
 const admin=read("assets/js/admin.js");
 assert.match(prefs,/operationsDigest: true/);
 assert.match(settings,/state\.profile\?\.role!=="super"/);
 assert.match(settings,/input\.dataset\.path="notifications\.operationsDigest"/);
 assert.match(settings,/mountFounderDigestPreference\(\); applyControls\(\)/);
 assert.match(admin,/\["curator","operations","launches"\]\.includes\(requestedTab\)/);
 assert.match(admin,/document\.querySelector\('\.admin-nav button\[data-tab=/);
 assert.match(admin,/button\.dataset\.tab === "curator"/);
 assert.match(admin,/button\.dataset\.tab === "launches"/);
});

test("maintenance worker expires temporary suspensions before founder digest",async()=>{
 const source=read("netlify/functions/automation-maintenance.js");
 const calls=[];
 const db={rpc:async name=>{calls.push(name);return{data:{notified:0},error:null};}};
 const module={exports:{}};
 const env={SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"unit-secret"};
 const requireStub=id=>{
  if(id==="@supabase/supabase-js")return{createClient:()=>db};
  if(id==="./_lib/feed-refresh.cjs")return{maybeRefreshFeedCandidates:async()=>({skipped:true})};
  throw Error("Unexpected dependency: "+id);
 };
 vm.runInNewContext("(function(require,module,exports){"+source+"\n})",
   {process:{env},console:{log(){},error(){}}})(requireStub,module,module.exports);
 await module.exports.handler();
 assert.deepEqual(calls,["process_automation_tick","process_verification_maintenance","expire_moderation_suspensions","process_founder_operations_digest"]);
});

test("digest failure is surfaced rather than silently marked successful",async()=>{
 const source=read("netlify/functions/automation-maintenance.js");
 const module={exports:{}};
 const db={rpc:async name=>({data:null,error:name==="process_founder_operations_digest"?{code:"FAIL"}:null})};
 const requireStub=id=>id==="@supabase/supabase-js"?{createClient:()=>db}:
  id==="./_lib/feed-refresh.cjs"?{maybeRefreshFeedCandidates:async()=>({skipped:true})}:null;
 vm.runInNewContext("(function(require,module,exports){"+source+"\n})",
   {process:{env:{SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"test"}},
    console:{log(){},error(){}}})(requireStub,module,module.exports);
 await assert.rejects(()=>module.exports.handler(),e=>e.code==="FAIL");
});


test("suspension-expiry failure is visible and never proceeds to founder digest",async()=>{
 const source=read("netlify/functions/automation-maintenance.js");
 const calls=[];
 const db={rpc:async name=>{
  calls.push(name);
  return {data:0,error:name==="expire_moderation_suspensions"?{code:"E_TEST"}:null};
 }};
 const module={exports:{}};
 const requireStub=id=>id==="@supabase/supabase-js"?{createClient:()=>db}:
   id==="./_lib/feed-refresh.cjs"?{maybeRefreshFeedCandidates:async()=>({skipped:true})}:null;
 vm.runInNewContext("(function(require,module,exports){"+source+"\n})",
   {process:{env:{SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"test"}},
    console:{log(){},error(){}}})(requireStub,module,module.exports);
 await assert.rejects(()=>module.exports.handler(),/Moderation expiry maintenance failed/);
 assert.deepEqual(calls,[
   "process_automation_tick","process_verification_maintenance","expire_moderation_suspensions"
 ]);
});
