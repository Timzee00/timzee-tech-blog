const {createClient}=require("@supabase/supabase-js");
const {requireRole}=require("./_lib/auth-role.js");
const reply=(statusCode,data)=>({statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(data)});
exports.handler=async event=>{
 if(event.httpMethod!=="GET")return reply(405,{error:"GET only"});
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SERVICE_ROLE_KEY;
 if(!url||!key)return reply(503,{error:"Server authentication not configured"});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const token=(event.headers?.authorization||event.headers?.Authorization||"").replace(/^Bearer\s+/i,"");
 const guard=await requireRole(db,token,["super"],"Super Admin required.");
 if(guard.error)return reply(403,{error:guard.error});
 const days=Number(event.queryStringParameters?.days||30);
 if(![7,30,90].includes(days))return reply(400,{error:"Range must be 7, 30 or 90 days."});
 const {data:aggregate,error}=await db.rpc("site_aggregate_report",{p_days:days});
 if(error){
   console.warn("Aggregate traffic report unavailable",error.code);
   return reply(503,{error:"Aggregate traffic migration is not available. Check production database setup."});
 }
 // Opt-in browser identification is optional and must never block page-open
 // reports. A missing secret is a configuration issue, not a zero count.
 const secret=process.env.ANALYTICS_HMAC_SECRET;
 let optedIn=null;
 let optInState=(!secret||secret.length<32)?"not_configured":"available";
 if(optInState==="available"){
   const optional=await db.rpc("site_traffic_report",{p_days:days});
   if(optional.error){
     optInState="unavailable";
     console.warn("Opt-in traffic report unavailable",optional.error.code);
   }else optedIn=optional.data;
 }
 return reply(200,{
   aggregate,
   opt_in_browser_report:optedIn,
   opt_in_status:optInState,
   period_days:days,
   metric_note:"Aggregate page opens, engagement signals and join clicks. No identifier is stored for these totals; they are not distinct visitors. Opt-in unique-browser measurement is reported separately."
 });
};
