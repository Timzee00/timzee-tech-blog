const {createClient}=require("@supabase/supabase-js");
const {timingSafeEqual}=require("node:crypto");
function reply(statusCode,body){return{statusCode,headers:{"content-type":"application/json","cache-control":"no-store"},body:JSON.stringify(body)}}
function tokenMatches(actual,expected){
  if(!actual||!expected)return false;
  const a=Buffer.from(actual),b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
const suppressedEventKinds={
  hard_bounce:"hard_bounce",
  hardbounce:"hard_bounce",
  invalid_email:"invalid",
  spam:"spam",
  complaint:"spam",
  complained:"spam",
  invalid:"invalid",
  blocked:"blocked"
};
exports.handler=async event=>{
  if(event.httpMethod!=="POST")return reply(405,{error:"Method not allowed"});
  const expected=process.env.BREVO_WEBHOOK_TOKEN;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  const url=process.env.SUPABASE_URL;
  if(!expected||!key||!url)return reply(503,{error:"Webhook not configured"});
  const auth=event.headers?.authorization||event.headers?.Authorization||"";
  const bearer=auth.match(/^Bearer\s+(.+)$/i)?.[1]||"";
  if(!tokenMatches(bearer,expected))return reply(401,{error:"Unauthorized"});
  if((event.body||"").length>120000)return reply(413,{error:"Payload too large"});
  let events;
  try{events=JSON.parse(event.body||"{}");}catch{return reply(400,{error:"Malformed JSON"});}
  const batch=Array.isArray(events)?events:[events];
  if(batch.length>50)return reply(413,{error:"Too many events"});
  const supabase=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  let suppressed=0,ignored=0;
  for(const item of batch){
    const kind=suppressedEventKinds[String(item?.event||"").toLowerCase()];
    const email=String(item?.email||"").toLowerCase().trim();
    if(!kind||!email||email.length>320){ignored++;continue;}
    const result=await supabase.rpc("register_email_suppression",{p_email:email,p_reason:kind});
    if(result.error){console.error("Email suppression event persistence failed",result.error.message);return reply(503,{error:"Suppression update failed"});}
    if(result.data)suppressed++;else ignored++;
  }
  return reply(200,{ok:true,suppressed,ignored});
};
