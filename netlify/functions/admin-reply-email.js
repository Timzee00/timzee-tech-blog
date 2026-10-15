const {createClient}=require("@supabase/supabase-js");
const {requireRole}=require("./_lib/auth-role.js");
const send=(status,body)=>({statusCode:status,headers:{"content-type":"application/json","cache-control":"no-store"},body:JSON.stringify(body)});
const validUuid=s=>/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(s||""));
const escapeHtml=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
exports.handler=async event=>{
  if(event.httpMethod!=="POST")return send(405,{error:"Method not allowed"});
  if(process.env.EMAIL_DELIVERY_ENABLED!=="true"||process.env.EMAIL_REPLY_ENABLED!=="true")
    return send(503,{error:"In-site replies are paused until delivery and reply sending are explicitly enabled."});
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const brevo=process.env.BREVO_API_KEY,from=process.env.BREVO_SENDER_EMAIL;
  if(!url||!key||!brevo||!from)return send(503,{error:"Email provider or database is not configured."});
  const bearer=String(event.headers?.authorization||event.headers?.Authorization||"").replace(/^Bearer\s+/i,"");
  if(!bearer)return send(401,{error:"Sign in as staff to reply."});
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const authorized=await requireRole(db,bearer,["admin","super"],"Email replies require admin access");
  if(authorized.error)return send(403,{error:"Only an active admin can send replies."});
  if(Buffer.byteLength(String(event.body||""),"utf8")>8000)return send(413,{error:"Reply is too large."});
  let data={};
  try{data=JSON.parse(event.body||"{}");}catch{return send(400,{error:"Invalid reply format."});}
  const kind=String(data.kind||""),id=String(data.request_id||""),clientId=String(data.client_request_id||"");
  const subject=String(data.subject||"").trim(),message=String(data.message||"").trim();
  if(!["contact","support","ads"].includes(kind)||!validUuid(id)||!validUuid(clientId)
    ||subject.length<3||subject.length>180||/[\r\n]/.test(subject)||message.length<2||message.length>5000)
    return send(400,{error:"Enter a valid request, subject, and reply (maximum 5,000 characters)."});
  const claim=await db.rpc("claim_staff_email_reply",{
    p_actor_id:authorized.user.id,p_client_request_id:clientId,p_kind:kind,
    p_request_id:id,p_subject:subject,p_message:message
  });
  if(claim.error)return send(422,{error:"The request cannot be emailed. Check its address or access."});
  if(claim.data?.reserved!==true)
    return send(409,{error:"Reply not sent. The request is suppressed, rate-limited, or has already been submitted. Check reply history before retrying."});
  const replyId=claim.data.id,recipient=claim.data.recipient;
  let status="needs_review",reason="Provider outcome unknown",providerId="";
  try{
    const result=await fetch("https://api.brevo.com/v3/smtp/email",{
      method:"POST",signal:AbortSignal.timeout(9000),
      headers:{"api-key":brevo,"content-type":"application/json","accept":"application/json"},
      body:JSON.stringify({
        sender:{email:from,name:process.env.BREVO_SENDER_NAME||"Timzee Tech Hub"},
        to:[{email:recipient}],subject,
        textContent:message+"\n\n— Timzee Tech Hub",
        htmlContent:'<div style="font:16px/1.6 system-ui,sans-serif;max-width:640px;margin:auto"><h2>Timzee Tech Hub</h2><p style="white-space:pre-line">'+escapeHtml(message)+'</p><hr><p style="font-size:12px">Reply to your original request. Never send passwords or security codes.</p></div>',
        headers:{idempotencyKey:clientId}
      })
    });
    let response={};try{response=await result.json()}catch{}
    if(result.ok&&typeof response.messageId==="string"&&response.messageId.trim()){
      status="accepted";reason="";providerId=response.messageId.slice(0,255);
    }else if(result.status>=400&&result.status<500&&result.status!==429){
      status="rejected";reason="provider_rejected";
    }else{reason="provider_uncertain";}
  }catch{reason="network_uncertain";}
  const done=await db.rpc("finish_staff_email_reply",{
    p_reply_id:replyId,p_status:status,p_provider_id:providerId,p_category:reason
  });
  if(done.error||done.data!==true)return send(503,{error:"Provider response needs manual reconciliation. Do not retry blindly."});
  if(status==="accepted")return send(200,{ok:true,provider_accepted:true,message:"Brevo accepted the reply. Delivery is not yet confirmed."});
  return send(status==="rejected"?422:503,{ok:false,provider_accepted:false,
    error:status==="rejected"?"Brevo rejected the reply. Check sender configuration.":"Delivery outcome uncertain. Review the provider logs before attempting another reply."});
};