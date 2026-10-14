const {createClient}=require("@supabase/supabase-js");
exports.handler=async()=>{
  // Three independent controls prevent accidental re-engagement campaigns.
  if(process.env.EMAIL_DELIVERY_ENABLED!=="true" || process.env.EMAIL_INACTIVITY_ENABLED!=="true"){
    return {statusCode:200,body:"Inactivity reminders paused"};
  }
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return {statusCode:503,body:"Reminder database credentials not configured"};
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.rpc("prepare_inactivity_reminders",{p_dry_run:false,p_limit:10});
  if(error){console.error("Inactivity preparation failed",error.code||"DB_ERROR");return {statusCode:503,body:"Inactivity preparation unavailable"};}
  const summary={enabled:data?.enabled===true,eligible:Number(data?.eligible||0),enqueued:Number(data?.enqueued||0)};
  console.log("Inactivity reminder preparation",summary);
  return {statusCode:200,body:JSON.stringify(summary)};
};
exports.config={schedule:"30 8 * * *"};
