import {hasOptionalCookieConsent} from "./privacy-consent.js";
// Measurement stays opt-in. Anonymous per-browser IDs are created only after
// consent and are hashed server-side; admins and private routes are excluded.
const KEY="timzee_measurement_browser_id";
function eligible(){return hasOptionalCookieConsent("measurement") && !/^\/(admin|super)(?:\/|$)/.test(location.pathname);}
let sent=false;
let inFlight=false;
let retryAfter=0;

async function reportVisit(){
  if(sent||inFlight||!eligible()||Date.now()<retryAfter)return;
  let id;
  try{
    id=localStorage.getItem(KEY);
    if(!id){id=crypto.randomUUID();localStorage.setItem(KEY,id);}
  }catch{
    // Optional analytics must never disrupt navigation or login.
    return;
  }
  inFlight=true;
  try{
    const response=await fetch("/.netlify/functions/site-visit",{
      method:"POST",keepalive:true,
      headers:{"Content-Type":"application/json"},
      body:JSON.stringify({visitor:id,path:location.pathname||"/"})
    });
    if(response.ok){
      // Only a confirmed database write counts as sent. Failed requests may
      // retry later; don't permanently disable analytics for this browser tab.
      sent=true;
      retryAfter=0;
    }else{
      retryAfter=Date.now()+(response.status===503?120000:30000);
    }
  }catch{
    retryAfter=Date.now()+30000;
  }finally{
    inFlight=false;
  }
}

window.addEventListener("timzee:consent",event=>{
  if(!event.detail?.measurement){
    try{localStorage.removeItem(KEY);}catch{}
    sent=false;
    retryAfter=0;
    return;
  }
  retryAfter=0;
  void reportVisit();
});
window.addEventListener("online",()=>void reportVisit());
document.addEventListener("visibilitychange",()=>{
  if(document.visibilityState==="visible")void reportVisit();
});
if(document.readyState==="loading")
  document.addEventListener("DOMContentLoaded",()=>void reportVisit(),{once:true});
else void reportVisit();
