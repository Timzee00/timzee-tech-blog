const {createClient}=require("@supabase/supabase-js");
const {verifyInactivityToken}=require("./_lib/email-opt-out-token.js");
const respond=(code,data)=>({statusCode:code,headers:{"content-type":"application/json","cache-control":"no-store"},body:JSON.stringify(data)});
exports.handler=async event=>{
  if(event.httpMethod!=="POST")return respond(405,{error:"Method not allowed"});
  if((event.body||"").length>2400)return respond(413,{error:"Request too large"});
  let payload;
  try{payload=JSON.parse(event.body||"{}");}catch{return respond(400,{error:"Invalid request"});}
  let token;
  try{token=verifyInactivityToken(payload.token);}catch{return respond(503,{error:"Unsubscribe unavailable"});}
  if(!token)return respond(400,{error:"This unsubscribe link is invalid or expired"});
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return respond(503,{error:"Unsubscribe unavailable"});
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.rpc("opt_out_inactivity_from_email",{
    p_user_id:token.userId,p_job_id:token.jobId
  });
  if(error)return respond(503,{error:"Unsubscribe unavailable. Try again later."});
  if(data!==true)return respond(400,{error:"This reminder link is no longer valid"});
  return respond(200,{ok:true,message:"Future inactivity reminders are switched off for this account."});
};
