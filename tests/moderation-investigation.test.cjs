const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {loadHandler}=require("./helpers.cjs");
const read=p=>fs.readFileSync(path.resolve(__dirname,"..",p),"utf8");
const ID="11111111-1111-4111-8111-111111111111";
const REPORT="22222222-2222-4222-8222-222222222222";
const KEY="33333333-3333-4333-8333-333333333333";
function fakeDb(role="moderator",withError=null){
 const calls=[];
 const db={
  auth:{getUser:async()=>({data:{user:{id:ID}},error:null})},
  from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({
   data:{role,account_status:"active"},error:null})})})}),
  rpc:async(name,args)=>{calls.push({name,args});return {data:{ok:true,auditId:21},error:withError};}
 };
 return {db,calls};
}
function req(body){
 return {httpMethod:"POST",headers:{authorization:"Bearer session"},body:JSON.stringify(body)};
}
const payload={kind:"decision",reportId:REPORT,requestId:KEY,outcome:"confirmed",action:"suspend_24h",
 reason:"Repeated severe threatening behaviour confirmed by evidence.",evidence:"The original reported message and its context were reviewed."};
test("ordinary users and missing sessions cannot access investigations",async()=>{
 const regular=fakeDb("user");
 const handler=loadHandler("moderation-cases",regular.db);
 assert.equal((await handler({httpMethod:"GET",headers:{}})).statusCode,401);
 assert.equal((await handler(req(payload))).statusCode,403);
 assert.equal(regular.calls.length,0);
});
test("investigation requires written evidence and reason before any sanction",async()=>{
 const staff=fakeDb();
 const handler=loadHandler("moderation-cases",staff.db);
 const empty={...payload,evidence:"",reason:""};
 assert.equal((await handler(req(empty))).statusCode,400);
 assert.equal((await handler(req({...payload,outcome:"dismissed",action:"ban"}))).statusCode,400);
 assert.equal(staff.calls.length,0);
});
test("staff report decisions are bound to verified server-side identity",async()=>{
 const staff=fakeDb();
 const handler=loadHandler("moderation-cases",staff.db);
 const response=await handler(req({...payload,actorId:"spoofed-actor"}));
 assert.equal(response.statusCode,200);
 assert.equal(staff.calls.length,1);
 assert.equal(staff.calls[0].name,"staff_decide_content_report");
 assert.equal(staff.calls[0].args.p_actor,ID);
 assert.equal(staff.calls[0].args.p_report,REPORT);
 assert.equal(staff.calls[0].args.p_action,"suspend_24h");
 assert.equal(staff.calls[0].args.p_evidence,payload.evidence);
});
test("automated flags only permit reviewed reversible outcomes, never automatic bans",async()=>{
 const staff=fakeDb();
 const handler=loadHandler("moderation-cases",staff.db);
 let response=await handler(req({kind:"flag_review",flagId:3,decision:"ban",reason:"Sample reason longer than twenty characters.",requestId:KEY}));
 assert.equal(response.statusCode,400);
 response=await handler(req({kind:"flag_review",flagId:3,decision:"dismiss",reason:"No actual abuse was found in context.",requestId:KEY}));
 assert.equal(response.statusCode,200);
 assert.equal(staff.calls.length,1);
 assert.equal(staff.calls[0].name,"staff_review_automated_flag");
});
test("moderation database is locked behind service role and requires case evidence",()=>{
 const sql=read("supabase/migrations/20261024180000_moderation_investigations_and_account_sanctions.sql");
 const quickClose=read("supabase/migrations/20261024181500_require_investigation_before_report_resolution.sql");
 const flags=read("supabase/migrations/20261024181000_sitewide_comment_automod_mass_report_triage.sql");
 const audit=read("supabase/migrations/20261024182000_audited_automod_flag_resolution.sql");
 const worker=read("netlify/functions/automation-maintenance.js");
 const old=read("netlify/functions/moderate-content.js");
 const ui=read("assets/js/moderation-case-ui.mjs");
 const flagUI=read("assets/js/moderation-flags-ui.mjs");
 for(const required of ["moderation_case_notes","moderation_account_actions","staff_decide_content_report",
   "staff_lift_account_restriction","expire_moderation_suspensions","block_restricted_account_writes",
   "GRANT EXECUTE ON FUNCTION public.staff_decide_content_report"])
  assert.ok(sql.includes(required),"missing "+required);
 assert.match(sql,/REVOKE ALL ON public\.content_reports FROM PUBLIC,anon,authenticated/);
 assert.match(quickClose,/p_type='content_reports'/);
 assert.doesNotMatch(old,/content_reports:\["resolve","dismiss"\]/);
 assert.match(flags,/group_mass_reports_for_review/);
 assert.match(flags,/Temporarily held for automated safety review/);
 assert.match(audit,/staff_review_automated_flag/);
 assert.match(worker,/expire_moderation_suspensions/);
 assert.match(ui,/Evidence reviewed/);
 assert.match(flagUI,/Automated safety review/);
});

test("moderation queue searches the full database and accepts an investigation filter",()=>{
 const server=read("netlify/functions/moderation-cases.js");
 const ui=read("assets/js/moderation-case-ui.mjs");
 const page=read("moderator/dashboard.html");
 assert.ok(server.includes('query.search||""'));
 assert.ok(server.includes('request=request.ilike("reason","%"+literal+"%")'));
 assert.ok(server.includes('request=request.or("id.eq."+search+",content_id.eq."+search)'));
 assert.ok(server.includes('request=request.eq("status","open").eq("investigation_state","investigating")'));
 assert.ok(ui.includes('query.set("search",options.search)'));
 assert.ok(ui.includes('setTimeout(()=>{searchTimer=null;state.page=0;void loadReportQueue();},320)'));
 assert.ok(ui.includes('latestQueueRequest'));
 assert.ok(page.includes('value="investigating"'));
});

test("reports open directly with context and evidence checklist",()=>{
 const a=read("netlify/functions/moderation-cases.js");
 const b=read("assets/js/moderation-case-ui.mjs");
 const h=read("moderator/dashboard.html");
 assert.match(a,/postContext/);
 assert.match(b,/Investigation checklist/);
 assert.match(b,/Original article/);
 assert.match(h,/class="active" data-tab="reports"/);
});
