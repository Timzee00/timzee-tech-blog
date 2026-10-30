// Approximate country sync occurs only at restricted feature entry.
// The public override-presence response is CDN-cached; no auth call on a
// default global site. Never trust a browser-supplied country.
const cache=new Map();
let overrideCache={checked:0,required:true};
let overrideRequest=null;
async function needsRegionCheck(){
 if(Date.now()-overrideCache.checked<120000)return overrideCache.required;
 if(overrideRequest)return overrideRequest;
 overrideRequest=(async()=>{
  try{
   const controller=new AbortController();
   const timer=setTimeout(()=>controller.abort(),3200);
   try{
    const response=await fetch("/.netlify/functions/region-check",{method:"GET",
      cache:"default",signal:controller.signal});
    if(!response.ok)return true;
    const json=await response.json();
    if(typeof json?.overrides!=="boolean")return true;
    overrideCache={checked:Date.now(),required:json.overrides};
    return json.overrides;
   }finally{clearTimeout(timer);}
  }catch{return true;} // Failure never turns off country enforcement.
 })();
 try{return await overrideRequest;}finally{overrideRequest=null;}
}
export async function syncObservedRegion(supabase){
 if(!supabase)return false;
 if(!(await needsRegionCheck()))return true;
 if(!supabase?.auth?.getSession)return false;
 let session=null;
 try{
   const result=await supabase.auth.getSession();
   if(result.error)return false;
   session=result.data?.session||null;
 }catch{return false;}
 if(!session?.access_token||!session.user?.id)return false;
 const id=session.user.id;
 const existing=cache.get(id);
 if(existing&&Date.now()-existing<30*60*1000)return true;
 const controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),4500);
 try{
  const response=await fetch("/.netlify/functions/region-check",{
   method:"POST",
   headers:{"authorization":"Bearer "+session.access_token},
   credentials:"same-origin",
   cache:"no-store",signal:controller.signal
  });
  if(!response.ok)return false;
  const payload=await response.json();
  if(!["updated","cached","global_default"].includes(payload?.status))return false;
  cache.set(id,Date.now());return true;
 }catch{return false;}
 finally{clearTimeout(timer);}
}
