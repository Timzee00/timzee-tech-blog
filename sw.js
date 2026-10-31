/* Blipmood PWA: public static shell offline, private content always network-only.
 * Keep the existing opt-in push handler and same-origin notification navigation.
 * This worker never stores HTML user sessions, API results, chats or private media. */
"use strict";
const PWA_BUILD="__BLIPMOOD_ASSET_VERSION__";
const OFFLINE_CACHE="blipmood-offline-"+PWA_BUILD;
const STATIC_CACHE="blipmood-static-"+PWA_BUILD; // obsolete cache, deleted on upgrade
const OFFLINE_PAGE="/offline.html";
const OFFLINE_SHELL=[
 OFFLINE_PAGE,
 "/app.webmanifest",
 "/assets/brand/blipmood-emblem-light.png",
 "/assets/brand/blipmood-pwa-192.png",
 "/assets/brand/blipmood-pwa-512.png"
];
// Only three small public brand assets have a meaningful offline use.
// All other CSS, JS, media and font requests are left to native HTTP caching.
const OFFLINE_BRAND_ASSETS=new Set(OFFLINE_SHELL.filter(path=>path.startsWith("/assets/")));
function isSafeOfflineBrandRequest(request,url){
 return request.method==="GET"&&url.origin===self.location.origin&&
   !request.headers.has("Authorization")&&!request.headers.has("Range")&&
   request.destination==="image"&&OFFLINE_BRAND_ASSETS.has(url.pathname);
}
self.addEventListener("install",event=>{
 event.waitUntil((async()=>{
  const cache=await caches.open(OFFLINE_CACHE);
  await cache.addAll(OFFLINE_SHELL);
  await self.skipWaiting();
 })());
});
self.addEventListener("activate",event=>{
 event.waitUntil((async()=>{
  const names=await caches.keys();
  await Promise.all(names.filter(name=>
   name.startsWith("blipmood-offline-")||name.startsWith("blipmood-static-"))
   .filter(name=>name!==OFFLINE_CACHE&&name!==STATIC_CACHE).map(name=>caches.delete(name)));
  await self.clients.claim();
 })());
});
self.addEventListener("fetch",event=>{
 const request=event.request;
 if(request.method!=="GET")return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin)return;
 if(url.pathname==="/app.webmanifest"){
  event.respondWith((async()=>{
   try{return await fetch(request);}
   catch{return await caches.match("/app.webmanifest") ||
    new Response("{}",{status:503,headers:{"content-type":"application/manifest+json"}});}
  })());
  return;
 }
 if(request.mode==="navigate"){
  // Navigation is always network-first. NEVER cache account HTML or dynamic
  // content; offline users see a working local-first drafting workspace.
  event.respondWith((async()=>{
   try{return await fetch(request);}
   catch{
    return await caches.match(OFFLINE_PAGE) ||
     new Response("Blipmood is offline. Reconnect to continue.",{
      status:503,headers:{"content-type":"text/plain; charset=utf-8"}
     });
   }
  })());
  return;
 }
 // Do not intercept site scripts, styles, fonts or dynamic user assets.
 // Native HTTP caching is faster and does not require hundreds of IDB reads
 // and CacheStorage writes during first render / Lighthouse measurement.
 if(!isSafeOfflineBrandRequest(request,url))return;
 event.respondWith((async()=>{
  try{
   const cached=await caches.match(request,{ignoreSearch:true});
   return cached || await fetch(request);
  }catch{
   return fetch(request);
  }
 })());
});

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
