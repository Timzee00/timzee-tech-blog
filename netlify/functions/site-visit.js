const crypto=require("crypto");
const {createClient}=require("@supabase/supabase-js");
const reply=(statusCode,data)=>({statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},body:JSON.stringify(data)});
exports.handler=async event=>{
 if(event.httpMethod!=="POST")return reply(405,{error:"POST only"});
 if(Buffer.byteLength(event.body||"","utf8")>400)return reply(413,{error:"Invalid request"});
 let data;try{data=JSON.parse(event.body||"{}");}catch{return reply(400,{error:"Invalid JSON"});}
 // This is a privacy-preserving browser metric, not a guarantee of unique humans.
 const visitor=String(data.visitor||""),path=String(data.path||"");
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(visitor)||
   !/^\/[a-z0-9/_-]*(?:\.html)?$/i.test(path)||path.startsWith("/super/")||path.startsWith("/admin/"))
   return reply(400,{error:"Invalid measurement input"});
 const secret=process.env.ANALYTICS_HMAC_SECRET;
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SERVICE_ROLE_KEY;
 if(!secret||secret.length<32||!url||!key)return reply(503,{error:"Analytics not enabled"});
 const visitorHash=crypto.createHmac("sha256",secret).update(visitor).digest("hex");
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {error}=await db.rpc("record_site_visit",{p_hash:visitorHash});
 if(error){console.warn("Visitor report unavailable",error.code);return reply(503,{error:"Analytics storage unavailable"});}
 return reply(200,{ok:true});
};
