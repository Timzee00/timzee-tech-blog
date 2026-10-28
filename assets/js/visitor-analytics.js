import {hasOptionalCookieConsent} from "./privacy-consent.js";
// Visitor ID is created only after measurement consent. Do not track admin,
// private apps or signed-in identity, and do not use IP/device fingerprinting.
const KEY="timzee_measurement_browser_id";
const UNAVAILABLE_KEY="blipmood-analytics-unavailable";
function eligible(){return hasOptionalCookieConsent("measurement") && !/^\/(admin|super)\//.test(location.pathname);}
let sent=false;
async function reportVisit(){
 if(sent||!eligible()||sessionStorage.getItem(UNAVAILABLE_KEY)==="true")return;
 let id=localStorage.getItem(KEY);
 if(!id){id=crypto.randomUUID();localStorage.setItem(KEY,id);}
 sent=true;
 try{
   const response=await fetch("/.netlify/functions/site-visit",{method:"POST",keepalive:true,
     headers:{"Content-Type":"application/json"},body:JSON.stringify({visitor:id,path:location.pathname||"/"})});
   if(response.status===503)sessionStorage.setItem(UNAVAILABLE_KEY,"true");
 }catch{/* Analytics are optional; never interfere with page content. */}
}
window.addEventListener("timzee:consent",event=>{
 if(!event.detail?.measurement){localStorage.removeItem(KEY);sent=false;return;}
 void reportVisit();
});
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>void reportVisit(),{once:true});
else void reportVisit();
