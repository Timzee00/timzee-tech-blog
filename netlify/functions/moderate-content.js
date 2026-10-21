/* Transactionally audited staff moderation.
 * Browser -> verified staff session -> service-only PostgreSQL RPC.
 * The RPC checks the staff role again and updates content + audit in one commit.
 * Missing database migration intentionally fails closed (no unsafe fallback).
 */
const { randomUUID } = require("node:crypto");
const { parseJsonObject } = require("./_lib/request.js");
const { createClient } = require("@supabase/supabase-js");
const { requireRole } = require("./_lib/auth-role.js");

const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const allowed=Object.freeze({
  posts:["publish","unpublish","delete"],
  comments:["approve","hide","delete"],
  discussion_messages:["delete"],
  marketplace_items:["hide","delete"],
  videos:["hide","delete"],
  novels:["hide","delete"],
  content_reports:["resolve","dismiss"]
});
const json=(statusCode,body)=>({
  statusCode,
  headers:{"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"},
  body:JSON.stringify(body)
});
function tokenFrom(event){
  const header=event.headers?.authorization||event.headers?.Authorization||"";
  return /^Bearer\s+\S+$/i.test(header)?header.replace(/^Bearer\s+/i,"").trim():"";
}
function parseAction(payload){
  const type=String(payload.type||"");
  const action=String(payload.action||"");
  const id=String(payload.id||"");
  const requestId=payload.requestId===undefined?randomUUID():String(payload.requestId);
  if(!Object.hasOwn(allowed,type)||!allowed[type].includes(action)||!uuid.test(id)||!uuid.test(requestId))
    return {error:"Invalid moderation action, identifier or request key."};
  return {type,action,id,requestId};
}
exports.handler=async event=>{
  if(event.httpMethod!=="POST")return json(405,{error:"POST required."});
  const token=tokenFrom(event);
  if(!token)return json(401,{error:"Sign in as a moderator."});
  const parsed=parseJsonObject(event,8192);
  if(parsed.error)return json(parsed.statusCode,{error:parsed.error});
  const input=parseAction(parsed.payload);
  if(input.error)return json(400,{error:input.error});
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return json(503,{error:"Moderation service is unavailable."});
  try{
    const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const guard=await requireRole(db,token,["moderator","admin","super"],"Moderator permission required.");
    if(guard.error)return json(/token/i.test(guard.error)?401:403,{error:guard.error});
    const {data,error}=await db.rpc("moderate_content_transactional",{
      p_actor:guard.user.id,p_type:input.type,p_action:input.action,
      p_content_id:input.id,p_request_id:input.requestId
    });
    if(error){
      if(error.code==="P0002")return json(404,{error:"Content item was not found."});
      if(error.code==="42501")return json(403,{error:"Moderator permission is no longer active."});
      if(error.code==="23505")return json(409,{error:"Request key conflicts with another action."});
      if(error.code==="22023")return json(400,{error:"The moderation action is invalid."});
      console.error("Atomic moderation failed",error.code||"unknown");
      return json(503,{error:"Moderation was not completed. Please retry using the same request key."});
    }
    if(!data||data.ok!==true||!Number.isInteger(Number(data.auditId))){
      console.error("Moderation returned an incomplete audit receipt");
      return json(503,{error:"Moderation confirmation is unavailable."});
    }
    return json(200,{ok:true,auditRecorded:true,auditId:data.auditId,
      requestId:input.requestId,replayed:data.replayed===true});
  }catch(error){
    console.error("Moderation handler failed",error?.message||error);
    return json(503,{error:"Moderation service temporarily unavailable."});
  }
};
exports._test={parseAction};
