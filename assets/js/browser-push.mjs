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
async function refresh(){
 if(!button||!status)return;
 if(!supported()){button.disabled=true;put("This browser does not support web push or needs HTTPS.");return;}
 if(Notification.permission==="denied"){button.disabled=true;put("Notifications are blocked by your browser or Android. Open Chrome site settings and allow notifications for Blipmood.");return;}
 let config;
 try{const response=await fetch("/.netlify/functions/push-subscriptions",{cache:"no-store"});config=await response.json();}catch{button.disabled=true;put("Notification configuration is temporarily unavailable.");return;}
 if(!config?.enabled||!config.publicKey){button.disabled=true;put("Push notifications are not activated on this site yet.");return;}
 const registration=await navigator.serviceWorker.getRegistration("/");
 const existing=await registration?.pushManager.getSubscription();
 button.disabled=false;
 button.dataset.mode=existing?"off":"on";
 button.textContent=existing?"Turn off browser notifications":"Enable browser notifications";
 put(existing?"Push alerts are registered for this device. New notifications can appear when Blipmood is closed.":"Tap Enable to register this device for real background push. Allow Chrome and Android notification permissions.");
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
       try{await api("DELETE",subscription.toJSON());}
       finally{await subscription.unsubscribe();}
     }
     put("Browser notifications turned off.");
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
     put("Browser push registered. Sending a local confirmation notification…");
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