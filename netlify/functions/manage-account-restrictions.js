const {createClient}=require("@supabase/supabase-js");
const {requireRole}=require("./_lib/auth-role.js");
const {parseJsonObject}=require("./_lib/request.js");
const reply=(statusCode,body)=>({statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(body)});
const SCOPES=new Set(["all","posts","comments","videos","marketplace","messages"]);
const REASONS=new Set(["spam","harassment","fraud","impersonation","abuse","security","other"]);
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
function validateRestriction(input){
 const userId=String(input.userId||"");
 const scope=String(input.scope||"");
 const reason=String(input.reason||"");
 const explanation=String(input.explanation||"").trim();
 const hours=Number(input.hours);
 if(!UUID.test(userId))return "Valid target user ID required.";
 if(!SCOPES.has(scope))return "Unsupported restriction scope.";
 if(!REASONS.has(reason))return "Unsupported reason.";
 if(explanation.length<8||explanation.length>1000)return "Explanation must contain 8–1,000 characters.";
 if(!Number.isInteger(hours)||hours<1||hours>720)return "Duration must be between 1 and 720 hours.";
 return null;
}
exports.handler=async(event)=>{
 if(event.httpMethod!=="POST")return reply(405,{error:"Use POST."});
 const parsed=parseJsonObject(event);
 if(parsed.error)return reply(parsed.statusCode,{error:parsed.error});
 const body=parsed.payload;
 const action=String(body.action||"");
 if(!["restrict","revoke","list"].includes(action))return reply(400,{error:"Unsupported action."});
 const url=process.env.SUPABASE_URL, key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SERVICE_ROLE_KEY;
 if(!url||!key)return reply(503,{error:"Server configuration unavailable."});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const token=(event.headers?.authorization||event.headers?.Authorization||"").replace(/^Bearer\s+/i,"");
 const guard=await requireRole(db,token,["moderator","admin","super"],"Staff permission required.");
 if(guard.error)return reply(403,{error:guard.error});
 const canRestrict=guard.role==="super"||guard.role==="admin";
 if(action!=="list" && !canRestrict)return reply(403,{error:"Only administrators can change account restrictions."});
 const userId=String(body.userId||"");
 if(action==="list"){
  if(!UUID.test(userId))return reply(400,{error:"Valid user ID required."});
  const r=await db.from("account_restrictions").select("id,user_id,scope,reason_code,explanation,origin,status,created_at,expires_at,revoked_at")
   .eq("user_id",userId).order("created_at",{ascending:false}).limit(50);
  return r.error?reply(503,{error:"Restrictions table unavailable. Apply the reviewed migration first."}):reply(200,{records:r.data||[]});
 }
 if(action==="restrict"){
  const reason=validateRestriction(body);if(reason)return reply(400,{error:reason});
  if(userId===guard.user.id)return reply(403,{error:"You cannot restrict your own account."});
  // Staff targets are excluded until hierarchy verification is implemented;
  // prevents one admin disabling another administrator via a hidden action.
  const user=await db.from("profiles").select("id,role").eq("id",userId).maybeSingle();
  if(user.error||!user.data)return reply(404,{error:"User not found."});
  if(["super","admin","moderator"].includes(String(user.data.role||"").toLowerCase()))
   return reply(403,{error:"Staff account restrictions require a separate super-admin review."});
  const expires=new Date(Date.now()+Number(body.hours)*3600000).toISOString();
  const restriction=await db.from("account_restrictions").insert({
   user_id:userId,scope:body.scope,reason_code:body.reason,
   explanation:String(body.explanation).trim(),expires_at:expires,
   created_by:guard.user.id,origin:"manual"
  }).select("id,scope,expires_at").single();
  if(restriction.error)return reply(503,{error:"Could not save restriction. Check migration and service logs."});
  const audit=await db.from("moderation_audit").insert({
   moderator_id:guard.user.id,moderator_role:guard.role,
   action:"restrict",content_type:"account",content_id:userId,
   details:{restriction_id:restriction.data.id,scope:body.scope,reason:body.reason,expires_at:expires}
  });
  if(audit.error)console.error("Restriction audit failure",audit.error.code);
  return reply(200,{ok:true,restriction:restriction.data,auditRecorded:!audit.error});
 }
 const id=String(body.id||"");if(!UUID.test(id))return reply(400,{error:"Valid restriction ID required."});
 const note=String(body.note||"").trim();if(note.length<8||note.length>500)return reply(400,{error:"Revocation reason must be 8–500 characters."});
 const old=await db.from("account_restrictions").select("id,user_id,status").eq("id",id).maybeSingle();
 if(old.error||!old.data)return reply(404,{error:"Restriction not found."});
 if(old.data.status!=="active")return reply(409,{error:"Restriction already revoked."});
 const revoked=await db.from("account_restrictions").update({
  status:"revoked",revoked_at:new Date().toISOString(),revoked_by:guard.user.id,revoke_note:note
 }).eq("id",id).eq("status","active").select("id").maybeSingle();
 if(revoked.error||!revoked.data)return reply(409,{error:"Restriction could not be revoked."});
 const audit=await db.from("moderation_audit").insert({
  moderator_id:guard.user.id,moderator_role:guard.role,
  action:"revoke_restriction",content_type:"account",content_id:old.data.user_id,details:{restriction_id:id,reason:note}
 });
 if(audit.error)console.error("Restriction revocation audit failure",audit.error.code);
 return reply(200,{ok:true,auditRecorded:!audit.error});
};
