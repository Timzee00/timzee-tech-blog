const { createClient } = require("@supabase/supabase-js");

const templates = {
  contact_received: { subject: "We received your message | Timzee Tech Hub", body: "Your message has reached our team." },
  support_received: { subject: "Support request received | Timzee Tech Hub", body: "Your support request has been received. Our team will review it." },
  advertising_received: { subject: "Advertising inquiry received | Timzee Tech Hub", body: "Thank you for your advertising inquiry. We'll review your request." }
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
  const intro=name ? `Hello ${name},` : "Hello,";
  const text=`${intro}\n\n${template.body}\n\nReference: ${reference}\n\nTimzee Tech Hub`;
  const html=`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;padding:28px;color:#172b31"><h2 style="color:#0f766e">Timzee Tech Hub</h2><p>${escapeHtml(intro)}</p><p>${escapeHtml(template.body)}</p><p><strong>Reference:</strong> ${escapeHtml(reference)}</p><hr><small>Transactional notification regarding your request. Do not reply with passwords or sensitive details.</small></div>`;
  const res=await fetch("https://api.brevo.com/v3/smtp/email",{
    method:"POST",signal:timeout(8000),
    headers:{"api-key":apiKey,"content-type":"application/json"},
    body:JSON.stringify({
      sender:{email:senderEmail,name:senderName},
      to:[{email:job.recipient_email}],
      subject:template.subject,htmlContent:html,textContent:text,
      headers:{"X-Mailin-custom":"type:transactional"}
    })
  });
  let body={};try{body=await res.json()}catch{}
  if(!res.ok) throw new Error(`Brevo HTTP ${res.status}: ${String(body.message||"Delivery rejected").slice(0,180)}`);
  return String(body.messageId||"");
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
  const {data,error}=await supabase.rpc("claim_email_jobs",{p_limit:3});
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
    let success=false,providerId=null,errorMessage=null;
    try{providerId=await sendBrevo(job,brevoKey,senderEmail,senderName);success=true;results.sent++;}
    catch(err){errorMessage=String(err?.message||err);results.failed++;console.warn("Email send failed",job.id,errorMessage);}
    const {error:finishError}=await supabase.rpc("complete_email_job",{p_id:job.id,p_success:success,p_provider_id:providerId,p_error:errorMessage});
    if(finishError) console.error("Email completion write failed",job.id,finishError.message);
  }
  console.log("Email worker completed",results);
  return {statusCode:200,body:JSON.stringify(results)};
};
exports.config={schedule:"* * * *"};
