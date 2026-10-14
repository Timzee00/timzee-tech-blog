const {createClient}=require("@supabase/supabase-js");
const {requireRole}=require("./_lib/auth-role.js");
const response=(statusCode,body)=>({statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(body)});
exports.handler=async event=>{
 if(event.httpMethod!=="GET")return response(405,{error:"GET required."});
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SERVICE_ROLE_KEY;
 if(!url||!key)return response(503,{error:"Server configuration unavailable."});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const token=(event.headers?.authorization||event.headers?.Authorization||"").replace(/^Bearer\s+/i,"");
 const role=await requireRole(db,token,["super"],"Only Super Admins can see complete site totals.");
 if(role.error)return response(403,{error:role.error});
 const sources=[["posts","posts"],["comments","comments"],["topics","discussion_topics"],["users","profiles"]];
 const requests=await Promise.all(sources.map(async ([key,table])=>{
   const {count,error}=await db.from(table).select("id",{count:"exact",head:true});
   return {key,count,error};
 }));
 if(requests.some(r=>r.error))return response(503,{error:"Site statistics are currently unavailable."});
 const totals=Object.fromEntries(requests.map(r=>[r.key,r.count||0]));
 const {data:top,error}=await db.from("posts").select("id,title,views").order("views",{ascending:false}).limit(5);
 if(error)return response(503,{error:"Top post statistics unavailable."});
 return response(200,{totals,topPosts:top||[],note:"Post views reflect the existing counter; they are not deduplicated unique viewers."});
};
