/* Blipmood web push: private message content is never shown on lock screens. */
"use strict";
const DEFAULT_NOTIFICATION_URL="/profile.html?tab=notifications";
function safeNotificationUrl(destination){
  const fallback=new URL(DEFAULT_NOTIFICATION_URL,self.location.origin).href;
  if(typeof destination!=="string"||destination.length>1500)return fallback;
  try{
    const parsed=new URL(destination,self.location.origin);
    // Push payloads must never navigate to an external origin or a JS URL.
    if(parsed.origin!==self.location.origin||!["http:","https:"].includes(parsed.protocol))
      return fallback;
    return parsed.href;
  }catch{return fallback;}
}
self.addEventListener("push",event=>{
  let message={};
  try{message=event.data?event.data.json():{}}catch{message={};}
  // Only a generic message is displayed; actual notification details stay
  // behind the authenticated Blipmood inbox.
  const body="You have a new notification. Open Blipmood to review it.";
  const url=safeNotificationUrl(message?.url||DEFAULT_NOTIFICATION_URL);
  event.waitUntil(self.registration.showNotification("Blipmood",{
    body,tag:"blipmood-activity",
    icon:"/assets/brand/blipmood-emblem-light.png",
    badge:"/assets/brand/blipmood-emblem-light.png",
    renotify:false,data:{url}
  }));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const url=safeNotificationUrl(event.notification.data?.url);
    const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    const existing=windows.find(client=>{
      try{return new URL(client.url).origin===self.location.origin}catch{return false}
    });
    if(existing){
      try{
        if(existing.navigate)await existing.navigate(url);
        await existing.focus();
        return;
      }catch{/* A closed or inaccessible tab must not prevent opening the inbox. */}
    }
    await self.clients.openWindow(url);
  })());
});
