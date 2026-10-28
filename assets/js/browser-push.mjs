import {getSession} from "./supabase.js";
const button=document.getElementById("browserPushToggle")||document.getElementById("deviceAlertsBtn");
const status=document.getElementById("browserPushStatus")||document.getElementById("deviceAlertsHelp");
const put=value=>{if(status)status.textContent=value;};
const supported=()=>("serviceWorker" in navigator&&"PushManager" in window&&"Notification" in window&&window.isSecureContext);
const base64ToBytes=key=>{
 const normalized=String(key||"").replace(/-/g,"+").replace(/_/g,"/");
 const decoded=atob(normalized+"=".repeat((4-normalized.length%4)%4));
 return Uint8Array.from(decoded,c=>c.charCodeAt(0));
};
async function api(method,subscription){
 const session=await getSession();
 if(!session?.access_token)throw Error("Sign in to manage browser notifications.");
 const response=await fetch("/.netlify/functions/push-subscriptions",{
   method,headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},
   body:JSON.stringify({subscription})
 });
 let result={};try{result=await response.json();}catch{}
 if(!response.ok)throw Error(result.error||"Unable to save your notification preference.");
 return result;
}
// A browser PushSubscription can exist even when saving it to Blipmood
// failed, or when the user signed into a different account. Verify the
// server-side record before telling anyone their phone is subscribed.
async function isRegisteredOnServer(subscription){
 const session=await getSession();
 if(!session?.access_token)throw Error("Sign in again to reconnect this device.");
 if(!globalThis.crypto?.subtle)throw Error("Secure browser encryption is unavailable.");
 const digest=await crypto.subtle.digest("SHA-256",
  new TextEncoder().encode(subscription.endpoint));
 const hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,"0")).join("");
 const response=await fetch("/.netlify/functions/push-subscriptions?endpoint_hash="+hash,{
  headers:{Authorization:"Bearer "+session.access_token},cache:"no-store"
 });
 let result={};try{result=await response.json();}catch{}
 if(!response.ok)throw Error(result.error||"Device verification unavailable.");
 return result.subscribed===true;
}
async function refresh(){
 if(!button||!status)return;
 if(!supported()){button.disabled=true;put("This browser does not support web push or needs HTTPS.");return;}
 if(Notification.permission==="denied"){button.disabled=true;put("Notifications are blocked by your browser or Android. Open Chrome site settings and allow notifications for Blipmood.");return;}
 let config;
 try{const response=await fetch("/.netlify/functions/push-subscriptions",{cache:"no-store"});config=await response.json();}catch{button.disabled=true;put("Notification configuration is temporarily unavailable.");return;}
 if(!config?.enabled||!config.publicKey){button.disabled=true;put("Push notifications are not activated on this site yet.");return;}
 const registration=await navigator.serviceWorker.getRegistration("/");
 const existing=await registration?.pushManager.getSubscription();
 let registered=false;
 if(existing){
  try{registered=await isRegisteredOnServer(existing)}
  catch(error){
   button.disabled=false;
   button.dataset.mode="repair";
   button.dataset.publicKey=config.publicKey;
   button.textContent="Reconnect browser notifications";
   put((error?.message||"Cannot verify this device.")+" Tap Reconnect to register it again.");
   return;
  }
 }
 button.disabled=false;
 button.dataset.mode=existing?(registered?"off":"repair"):"on";
 button.textContent=existing
  ?(registered?"Turn off browser notifications":"Reconnect browser notifications")
  :"Enable browser notifications";
 put(existing
  ?(registered
   ?"This device is registered with Blipmood. Remote delivery is confirmed only when an actual alert arrives."
   :"Chrome has permission, but Blipmood has not saved this device. Tap Reconnect to fix push alerts.")
  :"Tap Enable to register this device for real background push. Allow Chrome and Android notification permissions.");
 button.dataset.publicKey=config.publicKey;
}
button?.addEventListener("click",async()=>{
 if(button.disabled)return;
 const mode=button.dataset.mode;
 button.disabled=true;
 try{
   if(mode==="off"){
     const reg=await navigator.serviceWorker.getRegistration("/");
     const subscription=await reg?.pushManager.getSubscription();
     if(subscription){
       await api("DELETE",subscription.toJSON());
       await subscription.unsubscribe();
     }
     put("Browser notifications turned off.");
   }else if(mode==="repair"){
     const reg=await navigator.serviceWorker.getRegistration("/");
     const existing=await reg?.pushManager.getSubscription();
     if(!existing)throw Error("No browser subscription found. Tap Enable to create one.");
     await api("POST",existing.toJSON());
     put("Device reconnected to Blipmood. Future remote alerts can now be delivered.");
   }else{
     // Browser permission must be initiated directly from this user gesture.
     const permission=await Notification.requestPermission();
     if(permission!=="granted")throw Error("Permission was not granted. No notifications will be sent.");
     const configKey=button.dataset.publicKey;
     const registration=await navigator.serviceWorker.register("/sw.js",{scope:"/"});
     await navigator.serviceWorker.ready;
     const subscription=await registration.pushManager.subscribe({
       userVisibleOnly:true,applicationServerKey:base64ToBytes(configKey)
     });
     try{await api("POST",subscription.toJSON());}
     catch(error){await subscription.unsubscribe();throw error;}
     put("Device registered with Blipmood. Showing a local permission confirmation; delivery still depends on a real notification.");
      try{await registration.showNotification("Blipmood push enabled",{
        body:"Your device is subscribed. Future alerts can arrive when Blipmood is closed.",
        tag:"blipmood-push-setup",icon:"/assets/img/avatar-placeholder.svg",
        data:{url:"/profile.html?tab=notifications"}
      });}catch(error){console.warn("Setup notification unavailable",error?.name||"unknown");}
   }
 }catch(error){put(error?.message||"Unable to update push notifications.");}
 finally{await refresh().catch(()=>{button.disabled=false;});}
});
if(button)void refresh().catch(()=>put("Browser notifications are temporarily unavailable."));