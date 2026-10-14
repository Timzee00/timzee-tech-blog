const {createClient}=require("@supabase/supabase-js");
const {requireRole}=require("./_lib/auth-role.js");
const reply=(code,body)=>({statusCode:code,headers:{"content-type":"application/json","cache-control":"no-store"},body:JSON.stringify(body)});
exports.handler=async event=>{
  if(event.httpMethod!=="GET")return reply(405,{error:"Method not allowed"});
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return reply(503,{error:"Email metrics unavailable"});
  const token=(event.headers?.authorization||event.headers?.Authorization||"").replace(/^Bearer\s+/i,"");
  if(!token)return reply(401,{error:"Sign-in required"});
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const auth=await requireRole(db,token,["super"],"Super admin access required");
  if(auth.error)return reply(403,{error:"Access denied"});
  const {data,error}=await db.rpc("email_delivery_statistics");
  if(error)return reply(503,{error:"Email stats not activated"});
  return reply(200,{statistics:data,delivery_enabled:process.env.EMAIL_DELIVERY_ENABLED==="true"});
};