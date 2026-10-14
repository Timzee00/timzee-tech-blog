const {createClient}=require("@supabase/supabase-js");
const {requireRole}=require("./_lib/auth-role.js");
const reply=(statusCode,data)=>({statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(data)});
exports.handler=async event=>{
 if(event.httpMethod!=="GET")return reply(405,{error:"GET required."});
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SERVICE_ROLE_KEY;
 if(!url||!key)return reply(503,{error:"Server authentication unavailable."});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const token=(event.headers?.authorization||event.headers?.Authorization||"").replace(/^Bearer\s+/i,"");
 const guard=await requireRole(db,token,["admin","super"],"Staff directory access required.");
 if(guard.error)return reply(403,{error:guard.error});
 const params=event.queryStringParameters||{};
 const search=String(params.search||"").trim().slice(0,100);
 if(search.length<2)return reply(400,{error:"Enter at least two characters."});
 const page=Math.min(10000,Math.max(1,parseInt(params.page,10)||1));
 const size=12;
 // Escape PostgREST OR operators; all terms are literal user-supplied search.
 const escaped=search.replace(/[(),%_*\\]/g," ").trim().replace(/\s+/g," ");
 if(escaped.length<2)return reply(400,{error:"Enter at least two search characters."});
 const expr=["display_name","username","email"].map(column=>column+".ilike.%"+escaped+"%").join(",");
 const {data,error,count}=await db.from("profiles")
  .select("id,email,display_name,username,role,account_status,is_verified,is_staff_pick,is_featured,created_at",{count:"exact"})
  .or(expr).order("created_at",{ascending:false})
  .range((page-1)*size,page*size-1);
 if(error)return reply(503,{error:"User search is temporarily unavailable."});
 return reply(200,{users:data||[],page,total:count||0,hasMore:(count||0)>page*size});
};
