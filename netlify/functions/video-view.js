"use strict";
// Free, server-side anonymous view receipt. No paid analytics service,
// browser fingerprint cookie, raw IP storage or public privileged RPC.
const crypto=require("node:crypto");
const {createClient}=require("@supabase/supabase-js");
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const json=(statusCode,data)=>({
 statusCode,
 headers:{"Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"},
 body:JSON.stringify(data)
});
exports.handler=async event=>{
 if(event.httpMethod!=="POST")return json(405,{credited:false});
 const headers=Object.fromEntries(Object.entries(event.headers||{})
  .map(([key,value])=>[key.toLowerCase(),String(value||"")]));
 const origin=headers.origin||"";
 // Browsers send Origin on cross-site JSON POSTs. Never allow a third-party
 // site to spend our free database/function quota via cross-origin requests.
 if(origin){
  let originHost="";
  try{const u=new URL(origin);if(u.protocol==="https:")originHost=u.host}catch{}
  if(!originHost||originHost!==headers.host)return json(403,{credited:false});
 }
 if(headers["sec-fetch-site"]==="cross-site")return json(403,{credited:false});
 if(String(event.body||"").length>1024)return json(413,{credited:false});
 let videoId;
 try{videoId=JSON.parse(event.body||"{}").videoId}catch{return json(400,{credited:false})}
 if(typeof videoId!=="string"||!uuid.test(videoId))return json(400,{credited:false});
 const ua=(headers["user-agent"]||"").slice(0,256);
 if(ua.length<10||/bot|spider|crawler|headless|curl\//i.test(ua))
  return json(200,{credited:false});
 // Only trusted Netlify/Lambda connection IPs, never user-supplied X-Forwarded-For.
 const remoteIp=headers["x-nf-client-connection-ip"]||
  event.requestContext?.identity?.sourceIp||"";
 if(!remoteIp||remoteIp.length>65||!/^[0-9a-fA-F:.]+$/.test(remoteIp))
  return json(200,{credited:false});
 const key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 const url=process.env.SUPABASE_URL;
 if(!key||!url)return json(503,{credited:false});
 const sign=value=>crypto.createHmac("sha256",key).update("blipmood:reel-views:v1:"+value).digest("hex");
 // Approximate unique guest per network/browser per UTC day.  Never send
 // IP, HMAC key, user-agent, or private user profile to the client or database.
 const visitorHash=sign(remoteIp+"|"+ua),ipHash=sign("network|"+remoteIp);
 try{
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await client.rpc("record_guest_video_view",{
   p_video_id:videoId,p_visitor_hash:visitorHash,p_ip_hash:ipHash
  });
  if(error){console.error("Guest reel view RPC unavailable",error.code||"server");return json(503,{credited:false})}
  return json(200,{credited:data===true});
 }catch(error){
  console.error("Guest reel view service failed",error?.name||"server");
  return json(503,{credited:false});
 }
};
