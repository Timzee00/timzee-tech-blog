import {createClient} from "@supabase/supabase-js";
// Server-owned approximate country. Do not accept a client-provided country
// header/body; Netlify's platform geolocation is the sole detection source.
const validCode=c=>typeof c==="string"&&/^[A-Z]{2}$/.test(c);
const respond=(body,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{"content-type":"application/json; charset=utf-8",
 "cache-control":"private, no-store","x-content-type-options":"nosniff"}
});
let service=null;
function serverClient(){
 if(service)return service;
 if(!process.env.SUPABASE_URL||!process.env.SUPABASE_SERVICE_ROLE_KEY)return null;
 service=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{
  auth:{autoRefreshToken:false,persistSession:false}
 });
 return service;
}
export default async function regionCheck(request,context){
 if(request.method==="GET"){
  // This response contains no user information and can be cached by Netlify
  // edge for two minutes. At default all-global rules no auth call is needed.
  const supabase=serverClient();
  if(!supabase)return respond({overrides:true,status:"unavailable"},503);
  try{
   const {data,error}=await supabase.from("platform_feature_rules")
      .select("feature_key").neq("country_code","*").limit(1);
   if(error)throw error;
   return new Response(JSON.stringify({overrides:Boolean(data?.length)}),{
    headers:{"content-type":"application/json; charset=utf-8",
     "cache-control":"public, max-age=120",
     "netlify-cdn-cache-control":"public, s-maxage=120, stale-while-revalidate=120",
     "x-content-type-options":"nosniff"}
   });
  }catch{return respond({overrides:true,status:"unavailable"},503);}
 }
 if(request.method!=="POST")return respond({error:"Method not allowed"},405);
 const country=String(context?.geo?.country?.code||"").toUpperCase();
 const authorization=request.headers.get("authorization")||"";
 if(!validCode(country))return respond({country:null,status:"unavailable"},200);
 if(!authorization.startsWith("Bearer ")||authorization.length>3500)
  return respond({country,status:"guest"},200);
 const supabase=serverClient();
 if(!supabase)return respond({country,status:"service_unavailable"},503);
 try{
  const token=authorization.slice(7);
  const {data:{user},error:authError}=await supabase.auth.getUser(token);
  if(authError||!user?.id)return respond({country,status:"unauthenticated"},401);
  // Only persist approximate country when an override actually exists.
  // Otherwise skip the write and reduce database load for all-global rules.
  const {data:overrides,error:ruleError}=await supabase.from("platform_feature_rules")
    .select("feature_key").neq("country_code","*").limit(1);
  if(ruleError)throw ruleError;
  if(!overrides?.length)return respond({country,status:"global_default"},200);
  const {data:prev,error:previousError}=await supabase.from("platform_observed_regions")
    .select("country_code,expires_at").eq("user_id",user.id).maybeSingle();
  if(previousError)throw previousError;
  if(prev?.country_code===country&&Date.parse(prev.expires_at)>Date.now()+36*3600000)
   return respond({country,status:"cached"},200);
  const now=new Date();
  const {error:saveError}=await supabase.from("platform_observed_regions").upsert({
   user_id:user.id,country_code:country,
   observed_at:now.toISOString(),
   expires_at:new Date(now.getTime()+72*3600000).toISOString()
  },{onConflict:"user_id"});
  if(saveError)throw saveError;
  return respond({country,status:"updated"},200);
 }catch(error){
  console.error("Regional context verification failed",error?.code||"unknown");
  return respond({country,status:"unavailable"},503);
 }
}
