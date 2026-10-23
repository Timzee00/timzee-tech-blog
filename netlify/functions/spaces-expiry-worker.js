/**
 * Independent Netlify scheduled audio-session cleanup.
 * A failed publishing, verification or digest tick must never block media expiry.
 * Netlify scheduled functions only run on a published deployment.
 */
const {createClient}=require("@supabase/supabase-js");
const {expireSpaces}=require("./_lib/spaces-expiry.cjs");
exports.handler=async()=>{
 const {SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY}=process.env;
 if(!SUPABASE_URL||!SUPABASE_SERVICE_ROLE_KEY)
  throw Error("Spaces expiry database credentials are not configured.");
 const db=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,{
  auth:{persistSession:false,autoRefreshToken:false}
 });
 const summary=await expireSpaces({db,env:process.env});
 if(!summary.skipped)console.log("Confirmed expired media rooms:",summary.expired);
 return {statusCode:200,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},
  body:JSON.stringify({ok:true,expired:summary.expired,skipped:summary.skipped})};
};
