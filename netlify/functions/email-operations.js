const {createClient}=require("@supabase/supabase-js");
const {requireRole}=require("./_lib/auth-role.js");
const reply=(code,body)=>({statusCode:code,headers:{"content-type":"application/json","cache-control":"no-store"},body:JSON.stringify(body)});
// Expose a non-sensitive database error code to help distinguish missing
// PostgREST RPCs, access policies and stale Netlify deployments.
function serviceError(operation,error){
 const code=String(error?.code||"DB_ERROR").replace(/[^A-Z0-9_]/gi,"").slice(0,24);
 console.error("Email operations RPC failed",operation,code);
 const hint=code==="PGRST202"?"Supabase API schema cache may be stale or this RPC is absent.":
   code==="42501"?"This function cannot execute the private operation with its configured service role.":
   "Check the deployed function environment and Supabase logs.";
 return reply(503,{error:operation+" unavailable. "+hint,diagnostic_code:code});
}
exports.handler=async event=>{
  if(!["GET","POST"].includes(event.httpMethod))return reply(405,{error:"Method not allowed"});
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return reply(503,{error:"Email metrics unavailable"});
  const token=(event.headers?.authorization||event.headers?.Authorization||"").replace(/^Bearer\s+/i,"");
  if(!token)return reply(401,{error:"Sign-in required"});
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const auth=await requireRole(db,token,["super"],"Super admin access required");
  if(auth.error)return reply(403,{error:"Access denied"});
  if(event.httpMethod==="POST") {
    if((event.body||"").length>3500)return reply(413,{error:"Review is too large"});
    let payload;
    try{payload=JSON.parse(event.body||"{}");}catch{return reply(400,{error:"Invalid JSON"});}
    const id=String(payload.job_id||"");
    const decision=String(payload.decision||"");
    const note=String(payload.note||"").trim();
    const validUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
    const decisions=new Set(["needs_investigation","provider_delivery_confirmed","provider_not_sent_confirmed","closed_no_retry"]);
    if(!validUuid||!decisions.has(decision)||note.length<15||note.length>1000) {
      return reply(400,{error:"Choose a valid case, decision and review note (15–1000 characters)."});
    }
    const {data,error}=await db.rpc("record_email_review_action",{
      p_job_id:id,p_actor_id:auth.user.id,p_decision:decision,p_note:note
    });
    if(error)return reply(409,{error:"Could not save review. The case may already be closed or unavailable."});
    return reply(200,{reviewed:true,decision:data?.decision||decision,email_sent:false});
  }
  if(event.queryStringParameters?.review==="1") {
    const {data,error}=await db.rpc("list_email_review_cases",{p_limit:25});
    if(error)return serviceError("Manual review queue",error);
    const cases=Array.isArray(data)?data.map(item=>({
      id:item.id,template:item.template,attempts:item.attempts,
      created_at:item.created_at,updated_at:item.updated_at,
      delivery_state:item.delivery_state,last_decision:item.last_decision,
      reviewed_at:item.reviewed_at,
      reason:String(item.reason||"").replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,"[redacted email]")
    })):[];
    return reply(200,{cases,delivery_enabled:process.env.EMAIL_DELIVERY_ENABLED==="true"});
  }
  if(event.queryStringParameters?.legacyRecovery === "1") {
    const {data,error}=await db.rpc("legacy_user_recovery_overview");
    if(error)return serviceError("Existing-user recovery overview",error);
    const allowed=["total_members","email_confirmed","no_recent_activity_30d",
      "no_recent_activity_60d","no_recent_activity_90d","has_visit_tracking",
      "documented_newsletter_consent","documented_newsletter_and_inactive_30d",
      "inactivity_reminder_opted_in"];
    const counts=Object.fromEntries(allowed.map(key=>[key,Math.max(0,Number(data?.[key]||0))]));
    return reply(200,{counts,auto_send:false,dry_run:true,
      notice:"Last sign-in is an activity proxy. No marketing permission is inferred."});
  }
  if(event.queryStringParameters?.inactivityPreview === "1"){
    const {data,error}=await db.rpc("prepare_inactivity_reminders",{p_dry_run:true,p_limit:10});
    if(error)return serviceError("Inactivity preview",error);
    return reply(200,{dry_run:true,enabled:data?.enabled===true,
      eligible:Number(data?.eligible||0),remaining_budget:Number(data?.remaining_budget||0),
      enqueued:0});
  }
  if(event.queryStringParameters?.digestPreview === "1") {
    const {data,error}=await db.rpc("prepare_email_digests",{p_dry_run:true,p_limit:10});
    if(error)return serviceError("Digest preview",error);
    return reply(200,{dry_run:true,enabled:data?.enabled===true,
      eligible:Number(data?.eligible||0),remaining_budget:Number(data?.remaining_budget||0),
      enqueued:0});
  }
  if(event.queryStringParameters?.verifyProvider === "1") {
    const apiKey=process.env.BREVO_API_KEY;
    if(!apiKey)return reply(503,{provider:"Brevo",authenticated:false,error:"Brevo API key is missing"});
    try {
      const response=await fetch("https://api.brevo.com/v3/account",{
        headers:{"api-key":apiKey,"accept":"application/json"},
        signal:AbortSignal.timeout(8000)
      });
      return reply(response.ok?200:503,{
        provider:"Brevo",authenticated:response.ok,http_status:response.status,
        message:response.ok?"Brevo API credentials authenticated. No email was sent.":"Brevo rejected the API credentials or the account request."
      });
    } catch {
      return reply(503,{provider:"Brevo",authenticated:false,error:"Could not reach Brevo to verify credentials"});
    }
  }
  const {data,error}=await db.rpc("email_delivery_statistics");
  if(error)return serviceError("Email statistics",error);
  return reply(200,{statistics:data,delivery_enabled:process.env.EMAIL_DELIVERY_ENABLED==="true"});
};