/* Read-only founder operations overview.
 * No paid monitoring provider, cron dependency, or staff invitations required.
 * All privileged queries remain server-side; browser never receives service keys. */
const {createClient}=require("@supabase/supabase-js");
const {requireRole}=require("./_lib/auth-role.js");

const json=(statusCode,body)=>({
  statusCode,
  headers:{"Content-Type":"application/json","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"},
  body:JSON.stringify(body)
});

const QUEUES=Object.freeze([
  {key:"verification",table:"verification_applications",column:"status",value:"pending"},
  {key:"reports",table:"content_reports",column:"status",value:"open"},
  {key:"communityReports",table:"community_reports",column:"status",value:"open"},
  {key:"autoModeration",table:"community_auto_moderation",column:"state",value:"pending"},
  {key:"scheduledPosts",table:"posts",column:"status",value:"scheduled"}
]);
const JOB_WINDOWS_MINUTES=Object.freeze({
  "automation-maintenance":90,
  "curator-scout":180,
  "verification-maintenance":1620
});
const noErrors=jobs=>jobs.every(j=>j.state==="healthy");

function describeJob(row,now=Date.now()){
  const label=String(row?.job_name||"");
  const maxAge=JOB_WINDOWS_MINUTES[label]||180;
  const succeededAt=row?.last_succeeded_at||null;
  const failedAt=row?.last_failed_at||null;
  const succeeded=Date.parse(succeededAt||"");
  const failed=Date.parse(failedAt||"");
  const validSuccess=Number.isFinite(succeeded);
  const recentError=Number.isFinite(failed)&&(!validSuccess||failed>succeeded);
  return {
    name:label,
    lastSuccess:succeededAt,
    lastFailure:failedAt,
    maxAgeMinutes:maxAge,
    state:recentError?"failed":(!validSuccess||now-succeeded>maxAge*60_000)?"stale":"healthy"
  };
}

async function overview(db,now=Date.now()){
  const results=await Promise.all([
    ...QUEUES.map(async item=>{
      try{
        const {count,error}=await db.from(item.table).select("id",{count:"exact",head:true})
          .eq(item.column,item.value);
        if(error)throw error;
        if(!Number.isInteger(count))throw Error("Count unavailable");
        return {key:item.key,count};
      }catch(error){
        console.error("Operations metric unavailable",item.key,error?.message||error);
        return {key:item.key,count:null};
      }
    }),
    (async()=>{
      try{
        const {data,error}=await db.from("system_job_status")
          .select("job_name,last_succeeded_at,last_failed_at")
          .in("job_name",Object.keys(JOB_WINDOWS_MINUTES)).limit(10);
        if(error)throw error;
        const byName=new Map((data||[]).map(j=>[j.job_name,j]));
        return Object.keys(JOB_WINDOWS_MINUTES)
          .map(name=>describeJob(byName.get(name)||{job_name:name},now));
      }catch(error){
        console.error("Operations jobs unavailable",error?.message||error);
        return Object.keys(JOB_WINDOWS_MINUTES).map(name=>({
          name,state:"unknown",lastSuccess:null,lastFailure:null,
          maxAgeMinutes:JOB_WINDOWS_MINUTES[name]
        }));
      }
    })(),
    (async()=>{
      try{
        const {data,error}=await db.from("moderation_audit")
          .select("action,content_type,created_at")
          .order("created_at",{ascending:false}).limit(8);
        if(error)throw error;
        return Array.isArray(data)?data:[];
      }catch(error){
        console.error("Operations audit unavailable",error?.message||error);
        return null;
      }
    })()
  ]);
  const queueResults=results.slice(0,QUEUES.length);
  const jobs=results[QUEUES.length];
  const audit=results[QUEUES.length+1];
  const queues=Object.fromEntries(queueResults.map(row=>[row.key,row.count]));
  const issues=[
    ...queueResults.filter(row=>row.count===null).map(row=>row.key+" metric unavailable"),
    ...queueResults.filter(row=>row.count>0&&row.key!=="scheduledPosts")
      .map(row=>row.count+" pending "+row.key+" item(s)"),
    ...jobs.filter(j=>j.state!=="healthy").map(j=>j.name+" "+j.state),
    ...(audit===null?["Audit activity unavailable"]:[])
  ];
  return {
    checkedAt:new Date(now).toISOString(),
    queues,
    jobs,
    audit,
    summary:issues.length?"attention":"healthy",
    issues,
    note:"Read-only status. A stale job may mean that your free hosting is paused. No automatic sanctions or identity approvals are triggered here."
  };
}

exports.handler=async event=>{
  if(event.httpMethod!=="GET")return json(405,{error:"GET required."});
  const token=(event.headers?.authorization||event.headers?.Authorization||"")
    .replace(/^Bearer\s+/i,"");
  if(!token)return json(401,{error:"Sign in as an administrator."});
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return json(503,{error:"Operations service is not configured."});
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const guard=await requireRole(db,token,["admin","super"],"Administrator permission required.");
  if(guard.error)return json(/token/i.test(guard.error)?401:403,{error:guard.error});
  try{return json(200,await overview(db));}
  catch(error){
    console.error("Operations overview failed",error?.message||error);
    return json(503,{error:"Operations summary is temporarily unavailable."});
  }
};

// Pure helpers are exported solely for fast deterministic unit tests.
exports._test={describeJob,overview,noErrors};
