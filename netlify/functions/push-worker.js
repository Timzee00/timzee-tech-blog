"use strict";
const {createClient}=require("@supabase/supabase-js");
const {sendPush,validVapidPair}=require("./_lib/web-push.cjs");
const json=(statusCode,obj)=>({statusCode,headers:{"content-type":"application/json","cache-control":"no-store"},body:JSON.stringify(obj)});
exports.handler=async()=>{
 const cfg={publicKey:process.env.PUSH_VAPID_PUBLIC_KEY,privateKey:process.env.PUSH_VAPID_PRIVATE_KEY,
   subject:"mailto:"+String(process.env.BREVO_SENDER_EMAIL||"")};
 if(process.env.PUSH_ENABLED!=="true")return json(200,{state:"paused",processed:0});
 if(!validVapidPair(cfg.publicKey,cfg.privateKey)||!/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cfg.subject))
   return json(503,{error:"Push signing configuration is invalid",processed:0});
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return json(503,{error:"Push database is unavailable"});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 try {
   const claim=await db.rpc("claim_web_push_deliveries",{p_limit:3});
   if(claim.error){console.error("Push claim failed",String(claim.error.code||"rpc"));return json(503,{error:"Delivery queue unavailable"});}
   const jobs=claim.data||[];
   const outcomes=await Promise.allSettled(jobs.map(async job=>{
     let delivery;
     try{
       delivery=await sendPush({endpoint:job.endpoint,keys:{p256dh:job.p256dh,auth:job.auth_key}},{
         title:"Timzee Tech Hub",body:"You have a new notification. Open Timzee Tech to review it.",url:"/profile.html?tab=notifications"
       },cfg);
     }catch(error){
       delivery={success:false,permanent:false,status:0};
       console.warn("Push delivery transport error",String(error?.code||error?.name||"network").slice(0,40));
     }
     const {error:finish}=await db.rpc("complete_web_push_delivery",{
       p_delivery:job.delivery_id,p_success:delivery.success,p_permanent:delivery.permanent,
       p_error:delivery.success?null:("Push provider response "+String(delivery.status))
     });
     if(finish)throw Error("Push result could not be stored");
     return delivery.success?"sent":(delivery.permanent?"expired":"retry");
   }));
   return json(200,{state:"processed",claimed:jobs.length,complete:outcomes.filter(x=>x.status==="fulfilled").length,failed:outcomes.filter(x=>x.status==="rejected").length});
 }catch(error){
   console.error("Push worker failed",String(error?.code||"worker").slice(0,30));
   return json(503,{error:"Push delivery temporarily unavailable"});
 }
};