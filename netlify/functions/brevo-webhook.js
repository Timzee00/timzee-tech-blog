const {createClient}=require("@supabase/supabase-js");
const {timingSafeEqual}=require("node:crypto");
function reply(statusCode,body){return{statusCode,headers:{"content-type":"application/json","cache-control":"no-store"},body:JSON.stringify(body)}}
function tokenMatches(actual,expected){
  if(!actual||!expected)return false;
  const a=Buffer.from(actual),b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
const eventKinds=Object.freeze({
  delivered:"delivered",hard_bounce:"hard_bounce",hardbounce:"hard_bounce",
  soft_bounce:"soft_bounce",softbounce:"soft_bounce",
  invalid_email:"invalid",invalid:"invalid",
  spam:"spam",complaint:"spam",complained:"spam",
  blocked:"blocked",deferred:"deferred"
});
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
  let suppressed=0,ignored=0,processed=0;
  for(const item of batch){
    const kind=eventKinds[String(item?.event||"").toLowerCase().trim()];
    const email=String(item?.email||"").toLowerCase().trim();
    if(!kind||!email||email.length>320){ignored++;continue;}
    const providerId=String(item["message-id"]||item.messageId||item.message_id||"").trim().slice(0,255);
    const rawEpoch=Number(item.ts_epoch ?? item.ts);
    const eventEpoch=Number.isSafeInteger(rawEpoch) && rawEpoch>0 ? rawEpoch : null;
    const result=await supabase.rpc("record_brevo_delivery_event",{
      p_event:kind,p_email:email,p_message_id:providerId,p_event_epoch:eventEpoch
    });
    if(result.error){
      console.error("Brevo delivery event persistence failed",result.error.message);
      return reply(503,{error:"Provider event could not be recorded"});
    }
    if(result.data?.handled!==true){ignored++;continue;}
    processed++;
    if(result.data.suppressed) suppressed++;
  }
  return reply(200,{ok:true,processed,suppressed,ignored});
};
