const {createClient}=require("@supabase/supabase-js");
exports.handler=async()=>{
  // Deploy safely: neither Netlify nor SQL dispatch may create digest jobs
  // until both separate feature gates are explicitly enabled.
  if(process.env.EMAIL_DELIVERY_ENABLED!=="true" || process.env.EMAIL_DIGEST_ENABLED!=="true"){
    return {statusCode:200,body:"Optional digest preparation paused"};
  }
  const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)return {statusCode:503,body:"Digest database configuration unavailable"};
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.rpc("prepare_email_digests",{p_dry_run:false,p_limit:10});
  if(error){console.error("Digest preparation failed",error.code||"DB_ERROR");return {statusCode:503,body:"Digest preparation unavailable"};}
  const result={enabled:data?.enabled===true,eligible:Number(data?.eligible||0),enqueued:Number(data?.enqueued||0)};
  console.log("Digest scheduler result",result);
  return {statusCode:200,body:JSON.stringify(result)};
};
exports.config={schedule:"0 8 * * *"};
