"use strict";
const crypto=require("node:crypto");
const {createClient}=require("@supabase/supabase-js");
const {validateSubscription}=require("./_lib/web-push.cjs");
const json=(statusCode,payload)=>({statusCode,headers:{"content-type":"application/json","cache-control":"no-store"},body:JSON.stringify(payload)});
exports.handler=async event=>{
 const method=String(event.httpMethod||"").toUpperCase();
 if(!["GET","POST","DELETE"].includes(method))return json(405,{error:"Method not allowed"});
 const publicKey=process.env.PUSH_VAPID_PUBLIC_KEY||"";
 const ready=Boolean(publicKey&&process.env.PUSH_VAPID_PRIVATE_KEY&&process.env.PUSH_ENABLED==="true");
 if(method==="GET")return json(200,{enabled:ready,publicKey:ready?publicKey:null});
 if(!ready)return json(503,{error:"Browser notifications are not available yet."});
 if((event.body||"").length>5000)return json(413,{error:"Subscription is too large"});
 let payload;
 try{payload=JSON.parse(event.body||"{}");}catch{return json(400,{error:"Invalid JSON"});}
 const token=String(event.headers?.authorization||event.headers?.Authorization||"").replace(/^Bearer\s+/i,"");
 if(!token)return json(401,{error:"Sign in to manage your notifications"});
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return json(503,{error:"Notification service is unavailable"});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:auth,error:authError}=await db.auth.getUser(token);
 if(authError||!auth?.user?.id)return json(401,{error:"Session expired. Sign in again."});
 const userId=auth.user.id;
 const {data:profile,error:profileError}=await db.from("profiles").select("account_status").eq("id",userId).maybeSingle();
 if(profileError||profile?.account_status!=="active")return json(403,{error:"Account is not active"});
 let normalized;
 try{normalized=validateSubscription(payload.subscription)}catch{return json(400,{error:"Invalid push subscription"});}
 const endpointHash=crypto.createHash("sha256").update(normalized.endpoint).digest("hex");
 if(method==="DELETE"){
   const {error}=await db.from("web_push_subscriptions").delete().eq("user_id",userId).eq("endpoint_hash",endpointHash);
   if(error)return json(503,{error:"Could not disable push alerts"});
   return json(200,{subscribed:false});
 }
 const {count,error:countError}=await db.from("web_push_subscriptions").select("id",{head:true,count:"exact"}).eq("user_id",userId).is("disabled_at",null);
 if(countError)return json(503,{error:"Could not check your devices"});
 const {data:existing,error:existingError}=await db.from("web_push_subscriptions").select("id").eq("user_id",userId).eq("endpoint_hash",endpointHash).maybeSingle();
 if(existingError)return json(503,{error:"Could not check this device"});
 if((count||0)>=5&&!existing)return json(429,{error:"Maximum five notification devices per account. Disable another device first."});
 const {error}=await db.from("web_push_subscriptions").upsert({
   user_id:userId,endpoint_hash:endpointHash,endpoint:normalized.endpoint,
   p256dh:normalized.keys.p256dh,auth_key:normalized.keys.auth,
   disabled_at:null,updated_at:new Date().toISOString()
 },{onConflict:"endpoint_hash"});
 if(error)return json(503,{error:"Could not register this device"});
 return json(200,{subscribed:true});
};