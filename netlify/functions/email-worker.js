const { createClient } = require("@supabase/supabase-js");

const templates = {
  contact_received: { subject: "We received your message | Timzee Tech Hub", body: "Your message has reached our team." },
  support_received: { subject: "Support request received | Timzee Tech Hub", body: "Your support request has been received. Our team will review it." },
  advertising_received: { subject: "Advertising inquiry received | Timzee Tech Hub", body: "Thank you for your advertising inquiry. We'll review your request." },
  message_digest: { subject: "Your unread messages | Timzee Tech Hub", body: "You have unread message notifications." },
  mention_digest: { subject: "Mentions and replies | Timzee Tech Hub", body: "You have unread mentions or replies." },
  marketplace_alerts: { subject: "Marketplace updates | Timzee Tech Hub", body: "You have unread marketplace notifications." },
  community_digest: { subject: "Community updates | Timzee Tech Hub", body: "You have unread community notifications." }
};
function escapeHtml(s) {
  return String(s || "").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
const timeout = ms => AbortSignal.timeout(ms);
async function sendBrevo(job,apiKey,senderEmail,senderName) {
  const template=templates[job.template];
  if(!template) throw new Error("Unrecognized template");
  const name=String(job.payload?.name || "").slice(0,120);
  const reference=String(job.payload?.reference || "").slice(0,100);
  const isDigest=job.template.endsWith("_digest") || job.template==="marketplace_alerts";
  const digestCount=Number.isSafeInteger(Number(job.payload?.count)) ?
    Math.max(1,Math.min(9999,Number(job.payload?.count))) : 1;
  const intro=name ? `Hello ${name},` : "Hello,";
  const message=isDigest ?
    `${template.body} ${digestCount} unread update${digestCount===1?"":"s"} in the last 24 hours. Sign in to review them.` : template.body;
  const referenceLine=isDigest?"":`Reference: ${reference}\n\n`;
  const settingsUrl="https://timzee-tech-blog.netlify.app/settings.html#email";
  const text=`${intro}\n\n${message}\n\n${referenceLine}${isDigest ? `Manage email preferences: ${settingsUrl}\n\n` : ""}Timzee Tech Hub`;
  const html=`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#172b31"><h2 style="color:#0f766e">Timzee Tech Hub</h2><p>${escapeHtml(intro)}</p><p>${escapeHtml(message)}</p>${isDigest ?
    `<p><a href="${settingsUrl}">Manage email preferences</a></p>` :
    `<p><strong>Reference:</strong> ${escapeHtml(reference)}</p>`}<hr><small>${isDigest?"You opted in to this optional digest. Disable it in your account settings.":"Transactional notification regarding your request."} Do not reply with passwords or sensitive details.</small></div>`;
  let res;
  try {
    res=await fetch("https://api.brevo.com/v3/smtp/email",{
      method:"POST",signal:timeout(8000),
      headers:{"api-key":apiKey,"content-type":"application/json","accept":"application/json"},
      body:JSON.stringify({
        sender:{email:senderEmail,name:senderName},
        to:[{email:job.recipient_email}],
        subject:template.subject,htmlContent:html,textContent:text,
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
exports.handler=async()=>{
  const url=process.env.SUPABASE_URL;
  const serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const brevoKey=process.env.BREVO_API_KEY;
  if(process.env.EMAIL_DELIVERY_ENABLED !== "true") return {statusCode:200,body:"Email delivery paused"};
  const senderEmail=process.env.BREVO_SENDER_EMAIL;
  const senderName=process.env.BREVO_SENDER_NAME||"Timzee Tech Hub";
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
    let success=false,providerId=null,errorMessage=null;
    try{providerId=await sendBrevo(job,brevoKey,senderEmail,senderName);success=true;results.sent++;}
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
    if(finishError) console.error("Email completion write failed",job.id,finishError.message);
  }
  console.log("Email worker completed",results);
  return {statusCode:200,body:JSON.stringify(results)};
};
exports.config={schedule:"* * * *"};
