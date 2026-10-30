const { createClient } = require("@supabase/supabase-js");
const {createInactivityToken}=require("./_lib/email-opt-out-token.js");

const identityActions=Object.freeze({
  affiliation_invite:{subject:"Organization invitation | Blipmood",body:"A verified organization invited you to connect your Blipmood account. Open your profile to review the invitation."},
  affiliation_confirmed:{subject:"Your affiliation is confirmed | Blipmood",body:"Your organization affiliation is now confirmed and visible on your Blipmood profile."},
  affiliation_revoked:{subject:"Affiliation update | Blipmood",body:"An organization affiliation on your Blipmood account has ended."},
  advisor_appointment:{subject:"Your official appointment | Blipmood",body:"You received an official Blipmood appointment."},
  appointment_revoked:{subject:"Appointment update | Blipmood",body:"An official Blipmood appointment on your account has ended."},
  recognition_awarded:{subject:"You've earned recognition | Blipmood",body:"Blipmood has recognized your contribution with a new award."},
  recognition_revoked:{subject:"Recognition update | Blipmood",body:"An award on your Blipmood account has been withdrawn."},
  advisor_decision:{subject:"Advisor application reviewed | Blipmood",body:"Your Blipmood Advisor application has been reviewed. Sign in for your decision."}
});
const appointmentRoles=Object.freeze({
  product_lead:"Product Lead",product_advisor:"Product Advisor",
  community_advisor:"Community Advisor",community_contributor:"Community Contributor"
});
const templates = {
  contact_received: { subject: "We received your message | Blipmood", body: "Your message has reached our team." },
  support_received: { subject: "Support request received | Blipmood", body: "Your support request has been received. Our team will review it." },
  advertising_received: { subject: "Advertising inquiry received | Blipmood", body: "Thank you for your advertising inquiry. We'll review your request." },
  message_digest: { subject: "Your unread messages | Blipmood", body: "You have unread message notifications." },
  mention_digest: { subject: "Mentions and replies | Blipmood", body: "You have unread mentions or replies." },
  marketplace_alerts: { subject: "Marketplace updates | Blipmood", body: "You have unread marketplace notifications." },
  community_digest: { subject: "Community updates | Blipmood", body: "You have unread community notifications." },
  support_status: { subject: "Support request update | Blipmood", body: "The status of your support request has changed." },
  advertising_status: { subject: "Advertising request update | Blipmood", body: "Your advertising request has a new status." },
  verification_status: { subject: "Verification application update | Blipmood", body: "Your verification application has a new status." },
  report_status: { subject: "Report review update | Blipmood", body: "Your submitted report has a new status." },
  inactivity_reminder: { subject: "A friendly check-in from Blipmood", body: "It's been a while since your last visit. Your Blipmood account is here whenever you're ready to return." },
  identity_update: { subject: "Official account update | Blipmood", body: "An official account record has changed." }
};
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
const timeout = ms => AbortSignal.timeout(ms);
async function sendBrevo(job,apiKey,senderEmail,senderName) {
  const template=templates[job.template];
  if(!template) throw new Error("Unrecognized template");
  const isIdentity=job.template==="identity_update";
  const identityAction=isIdentity?identityActions[job.payload?.identity_action]:null;
  if(isIdentity&&!identityAction)throw new Error("Unrecognized identity action");
  const name=String(job.payload?.name || "").slice(0,120);
  const reference=String(job.payload?.reference || "").slice(0,100);
  const isDigest=job.template.endsWith("_digest") || job.template==="marketplace_alerts";
  const isInactivity=job.template==="inactivity_reminder";
  const isWorkflow=["support_status","advertising_status","verification_status","report_status"].includes(job.template);
  const optional=isDigest||isInactivity;
  const state=String(job.payload?.status||"").replace(/_/g," ").replace(/[^a-z ]/gi,"").slice(0,35);
  const digestCount=Number.isSafeInteger(Number(job.payload?.count)) ?
    Math.max(1,Math.min(9999,Number(job.payload?.count))) : 1;
  const intro=name ? `Hello ${name},` : "Hello,";
  const message=isIdentity ? identityAction.body+(job.payload?.identity_action==="advisor_appointment" ? ` Your role: ${appointmentRoles[job.payload?.role]||"Contributor"}.`:"") : isDigest ?
    `${template.body} ${digestCount} unread update${digestCount===1?"":"s"} in the last 24 hours. Sign in to review them.` :
    isWorkflow ? `${template.body} Current status: ${state||"updated"}.` : template.body;
  const referenceLine=(optional||isIdentity)?"":`Reference: ${reference}\n\n`;
  const settingsUrl="https://blipmood.netlify.app/settings.html#email";
  const unsubscribeUrl=isInactivity ?
    "https://blipmood.netlify.app/unsubscribe.html?token="+
      encodeURIComponent(createInactivityToken(job)) : null;
  const optOutText=unsubscribeUrl ? "Stop future check-in emails: "+unsubscribeUrl+"\n\n" : "";
  const optOutHtml=unsubscribeUrl ? `<p><a href="${unsubscribeUrl}">Stop these reminders without signing in</a></p>` : "";
  const accountUrl=isIdentity?(job.payload?.identity_action==="advisor_decision"?"https://blipmood.netlify.app/advisor.html":"https://blipmood.netlify.app/profile.html"):null;
  const text=`${intro}\n\n${message}\n\n${referenceLine}${accountUrl?`View your account update: ${accountUrl}\n\n`:""}${(optional||isIdentity) ? `Manage email preferences: ${settingsUrl}\n\n` : ""}${optOutText}Blipmood`;
  const html=`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#172b31"><div style="display:flex;align-items:center;gap:12px;padding:14px 16px;background:#101e24;border-radius:12px"><img src="https://blipmood.netlify.app/assets/brand/blipmood-wordmark-dark.png" width="230" height="76" alt="Blipmood" style="width:230px;max-width:100%;height:auto;display:block"></div><p>${escapeHtml(intro)}</p><p>${escapeHtml(message)}</p>${isIdentity ? `<p><a href="${accountUrl}">View your account update</a></p><p><a href="${settingsUrl}">Manage email preferences</a></p>` : optional ?
    `<p><a href="${settingsUrl}">Manage email preferences</a></p>` :
    `<p><strong>Reference:</strong> ${escapeHtml(reference)}</p>`}${optOutHtml}<hr><small>${isIdentity?"This is an official account-identity notification. You can opt out of these emails in Settings.":optional?"You opted in to this optional email category. You can disable it in account settings.":"Transactional notification regarding your request."} Do not reply with passwords or sensitive details.</small></div>`;
  let res;
  try {
    res=await fetch("https://api.brevo.com/v3/smtp/email",{
      method:"POST",signal:timeout(8000),
      headers:{"api-key":apiKey,"content-type":"application/json","accept":"application/json"},
      body:JSON.stringify({
        sender:{email:senderEmail,name:senderName},
        to:[{email:job.recipient_email}],
        subject:identityAction?.subject||template.subject,htmlContent:html,textContent:text,
        headers:{"X-Mailin-custom":"type:transactional",idempotencyKey:job.id}
      })
    });
  } catch {
    const failure=new Error("Brevo response unknown after network failure");
    failure.outcome="ambiguous";
    throw failure;
  }
  let body={};try{body=await res.json()}catch{}
  if(!res.ok) {
    const failure=new Error(`Brevo HTTP ${res.status}: ${String(body.message||"Request rejected").slice(0,150)}`);
    const duplicate=body.code==="duplicate_parameter" || String(body.message||"").includes("duplicate_parameter");
    failure.outcome=duplicate || res.status>=500 ? "ambiguous" : res.status===429 ? "retryable" : "terminal";
    throw failure;
  }
  if(typeof body.messageId!=="string" || !body.messageId.trim()) {
    const failure=new Error("Brevo accepted request without a usable message ID");
    failure.outcome="ambiguous";throw failure;
  }
  return body.messageId.trim();
}
async function runEmailWorker(){
  const url=process.env.SUPABASE_URL;
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const brevoKey=process.env.BREVO_API_KEY;
  if(process.env.EMAIL_DELIVERY_ENABLED !== "true") return {statusCode:200,body:"Email delivery paused"};
  const senderEmail=process.env.BREVO_SENDER_EMAIL;
  const senderName="Blipmood"; // Always present the product name; the verified sender email remains unchanged.
  if(!url||!serviceKey||!brevoKey||!senderEmail) {
    console.error("Email worker disabled: required server-only configuration missing");
    return {statusCode:503,body:"Email worker not configured"};
  }
  const supabase=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
  // Conservative free-plan reserve: leave capacity for Supabase Auth emails.
  const capInput=Number.parseInt(process.env.EMAIL_WORKER_DAILY_CAP||"50",10);
  const dailyCap=Number.isFinite(capInput)?Math.max(1,Math.min(250,capInput)):50;
  const {data:statistics,error:statsError}=await supabase.rpc("email_delivery_statistics");
  if(statsError) throw new Error("Email quota check unavailable; refusing to send");
  const remaining=Math.max(0,dailyCap-Number(statistics?.sent_last_24h||0));
  if(!remaining) return {statusCode:200,body:"Worker daily email cap reached"};
  const {data,error}=await supabase.rpc("claim_email_jobs",{p_limit:Math.min(1,remaining)});
  if(error) throw error;
  const results={claimed:data?.length||0,sent:0,failed:0};
  for(const job of data||[]){
    const suppression=await supabase.rpc("is_email_suppressed",{p_email:job.recipient_email});
    if(suppression.error){
      console.error("Email suppression check failed",job.id,suppression.error.message);
      throw new Error("Suppression lookup unavailable; refusing to send");
    }
    if(suppression.data===true){
      const stopped=await supabase.rpc("suppress_email_job",{p_id:job.id});
      if(stopped.error)throw new Error("Could not suppress email job");
      results.suppressed=(results.suppressed||0)+1;
      continue;
    }
    if(["message_digest","mention_digest","marketplace_alerts","community_digest"].includes(job.template)){
      const consent=await supabase.rpc("check_digest_consent",{
        p_email:job.recipient_email,p_template:job.template
      });
      if(consent.error)throw new Error("Digest consent check unavailable; refusing to send");
      if(consent.data!==true){
        const stopped=await supabase.rpc("suppress_email_job",{p_id:job.id});
        if(stopped.error)throw new Error("Unable to safely suppress opted-out digest");
        results.suppressed=(results.suppressed||0)+1;
        continue;
      }
    }
    if(["support_status","advertising_status","verification_status","report_status"].includes(job.template)){
      const current=await supabase.rpc("can_send_workflow_status",{
        p_template:job.template,p_reference:job.payload?.reference||"",
        p_status:job.payload?.status||"",p_email:job.recipient_email
      });
      if(current.error)throw new Error("Workflow status verification unavailable");
      if(current.data!==true){
        const stopped=await supabase.rpc("suppress_email_job",{p_id:job.id});
        if(stopped.error)throw new Error("Unable to stop stale workflow message");
        results.suppressed=(results.suppressed||0)+1;continue;
      }
    }
    if(job.template==="identity_update"){
      const current=await supabase.rpc("can_send_identity_update",{
        p_email:job.recipient_email,p_user_id:job.payload?.user_id,
        p_record_id:job.payload?.record_id,p_action:job.payload?.identity_action
      });
      if(current.error)throw new Error("Identity email eligibility check unavailable; refusing to send");
      if(current.data!==true){
        const stopped=await supabase.rpc("suppress_email_job",{p_id:job.id});
        if(stopped.error)throw new Error("Unable to stop stale or opted-out identity email");
        results.suppressed=(results.suppressed||0)+1;continue;
      }
    }
    if(job.template==="inactivity_reminder"){
      const eligible=await supabase.rpc("can_send_inactivity_reminder",{
        p_email:job.recipient_email,p_user_id:job.payload?.user_id,
        p_visit_at:job.payload?.last_seen_at
      });
      if(eligible.error)throw new Error("Inactivity consent validation unavailable");
      if(eligible.data!==true){
        const stopped=await supabase.rpc("suppress_email_job",{p_id:job.id});
        if(stopped.error)throw new Error("Unable to stop withdrawn inactivity reminder");
        results.suppressed=(results.suppressed||0)+1;continue;
      }
    }
    let success=false,providerId=null,errorMessage=null;
    try{providerId=await sendBrevo(job,brevoKey,senderEmail,senderName);success=true;}
    catch(err){
      errorMessage=String(err?.message||"Brevo delivery failed");
      if(err?.outcome!=="retryable") {
        const held=await supabase.rpc("quarantine_email_job",{p_id:job.id,p_reason:errorMessage});
        if(held.error || held.data!==true)throw new Error("Could not safely quarantine uncertain email job");
        results.quarantined=(results.quarantined||0)+1;
        console.warn("Email job quarantined for review",job.id);
        continue;
      }
      results.failed++;console.warn("Retryable email provider failure",job.id);
    }
    const {error:finishError}=await supabase.rpc("complete_email_job",{p_id:job.id,p_success:success,p_provider_id:providerId,p_error:errorMessage});
    if(finishError){
      // Brevo may already have accepted this message. Do not silently return
      // success or allow a lease/retry to produce a duplicate delivery.
      console.error("Email completion write failed",job.id,finishError.message);
      const held=await supabase.rpc("quarantine_email_job",{
        p_id:job.id,
        p_reason:"Delivery outcome could not be finalized. Reconcile with provider before retry."
      });
      if(held.error||held.data!==true)
        throw new Error("Email completion and quarantine both failed; manual reconciliation required");
      results.quarantined=(results.quarantined||0)+1;
      continue;
    }
    if(success)results.sent++;
  }
  console.log("Email worker completed",results);
  return {statusCode:200,body:JSON.stringify(results)};
}

// A scheduled invocation must never leak database/provider details to callers.
// Preserve fail-closed delivery behavior and record only the failing stage.
exports.handler=async()=>{
  try { return await runEmailWorker(); }
  catch(error){
    const code=String(error?.code||"WORKER_FAILURE").replace(/[^a-zA-Z0-9_]/g,"").slice(0,32);
    console.error("Email worker failed safely",code);
    return {statusCode:503,headers:{"content-type":"application/json","cache-control":"no-store"},body:JSON.stringify({ok:false,error:"Email processing temporarily unavailable",code})};
  }
};
// Schedule is managed centrally by netlify.toml every 15 minutes.
