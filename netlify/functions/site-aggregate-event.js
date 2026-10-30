// Cookie-free aggregate measurement. No persistent identifier is received or stored.
const crypto=require("node:crypto");
const {createClient}=require("@supabase/supabase-js");
const reply=(statusCode,data)=>({
  statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store"},
  body:JSON.stringify(data)
});
const validPage=/^\/(?:[a-z0-9-]{1,48}\.html)?$/;
const allowedEvents=new Set(["view","engaged","signup_click"]);
let db;
exports.handler=async(event)=>{
  if(event.httpMethod!=="POST")return reply(405,{error:"POST only"});
  // Preview and branch deploys must not inflate production analytics.
  if(process.env.CONTEXT && process.env.CONTEXT!=="production")return reply(202,{ignored:true});
  const h=event.headers||{};
  if(h["sec-fetch-site"]==="cross-site")return reply(403,{error:"Cross-site requests forbidden"});
  if(h.origin){
    try{
      if(new URL(h.origin).host!==h.host)return reply(403,{error:"Cross-site requests forbidden"});
    }catch{return reply(403,{error:"Invalid origin"});}
  }
  if(/bot|crawler|spider|preview|headless|lighthouse|pagespeed|curl|wget|python-requests|playwright/i.test(h["user-agent"]||""))
    return reply(202,{ignored:true});
  if(Buffer.byteLength(event.body||"","utf8")>160)return reply(413,{error:"Payload too large"});
  let input;
  try{input=JSON.parse(event.body||"{}");}catch{return reply(400,{error:"Invalid JSON"});}
  const page=String(input.page||"").toLowerCase();
  const kind=String(input.event||"");
  if(!validPage.test(page)||page==="/404.html"||page==="/offline.html"||!allowedEvents.has(kind))
    return reply(400,{error:"Invalid aggregate event"});
  const url=process.env.SUPABASE_URL;
  const key=process.env.SUPABASE_SERVICE_ROLE_KEY||process.env.SERVICE_ROLE_KEY;
  if(!url||!key)return reply(503,{error:"Aggregate measurement storage not configured"});
  try{
    if(!db)db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
    const {error}=await db.rpc("record_site_aggregate_event",{
      p_page:page,p_event:kind,p_shard:crypto.randomInt(32)
    });
    if(error){
      console.warn("Aggregate measurement failed",error.code);
      return reply(503,{error:"Aggregate measurement unavailable"});
    }
    return reply(200,{ok:true});
  }catch{
    return reply(503,{error:"Aggregate measurement temporarily unavailable"});
  }
};
