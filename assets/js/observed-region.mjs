// Approximate country sync is only invoked on feature entry/actions.
// 30-minute session cache avoids expensive server/auth calls per swipe.
const cache=new Map();
export async function syncObservedRegion(supabase){
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
