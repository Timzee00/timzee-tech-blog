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
 const {data,error}=await db.rpc("site_traffic_report",{p_days:days});
 if(error)return reply(503,{error:"Site visit analytics needs its staging-reviewed SQL migration."});
 return reply(200,{...data,period_days:days,metric_note:"Opted-in browser identifiers. Pageviews may include refreshes; unique browsers are deduplicated per UTC day. Not unique people."});
};
