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


// Aggregate-only traffic is independent of optional identifier-based analytics.
// Nothing about the visitor (no cookie, browser ID, IP, referrer or account) is
// sent; the API stores counts for this public HTML route, date and event kind.
// This is not a reliable count of distinct people or visit sessions.
(function collectPublicAggregateTraffic(){
  const page=(location.pathname||"/").toLowerCase();
  if(!/^\/(?:[a-z0-9-]{1,48}[.]html)?$/.test(page) ||
     page==="/404.html" || page==="/offline.html")return;
  const endpoint="/.netlify/functions/site-aggregate-event";
  const sent=new Set();
  const record=(kind)=>{
    if(sent.has(kind))return;
    sent.add(kind);
    // One small best-effort request per signal, without delaying page rendering.
    // No user data or persistent identifier is included in the request body.
    try{
      void fetch(endpoint,{
        method:"POST",keepalive:true,credentials:"omit",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({page,event:kind})
      }).catch(()=>{});
    }catch{}
  };
  record("view");

  let seconds=0, interacted=false, engaged=false;
  const markInteraction=()=>{interacted=true;check();};
  function check(){
    if(!engaged && seconds>=15 && interacted){
      engaged=true;
      clearInterval(clock);
      record("engaged");
    }
  }
  const clock=setInterval(()=>{
    if(document.visibilityState==="visible" && document.hasFocus())seconds++;
    if(seconds>=120)clearInterval(clock);
    check();
  },1000);
  window.addEventListener("scroll",()=>{
    if(window.scrollY>120)markInteraction();
  },{passive:true});
  document.addEventListener("pointerdown",markInteraction,{passive:true,once:true});
  document.addEventListener("keydown",markInteraction,{once:true});
  document.addEventListener("click",(event)=>{
    const anchor=event.target?.closest?.("a[href]");
    if(!anchor)return;
    try{
      const url=new URL(anchor.href,location.href);
      if(url.origin===location.origin &&
         /\/login[.]html$/.test(url.pathname) &&
         url.searchParams.get("view")==="signup"){
        record("signup_click");
      }
    }catch{}
  },{capture:true});
})();
