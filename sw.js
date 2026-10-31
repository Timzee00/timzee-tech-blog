/* Blipmood PWA: public static shell offline, private content always network-only.
 * Keep the existing opt-in push handler and same-origin notification navigation.
 * This worker never stores HTML user sessions, API results, chats or private media. */
"use strict";
const PWA_BUILD="__BLIPMOOD_ASSET_VERSION__";
const OFFLINE_CACHE="blipmood-offline-"+PWA_BUILD;
const STATIC_CACHE="blipmood-static-"+PWA_BUILD;
const OFFLINE_PAGE="/offline.html";
const OFFLINE_SHELL=[
 OFFLINE_PAGE,
 "/app.webmanifest",
 "/assets/brand/blipmood-emblem-light.png",
 "/assets/brand/blipmood-pwa-192.png",
 "/assets/brand/blipmood-pwa-512.png"
];
const ALLOWED_STATIC_PREFIXES=[
 "/assets/css/", "/assets/js/", "/assets/vendor/", "/assets/brand/"
];
const STATIC_MAX_ENTRIES=120;
function isSafeStaticRequest(request,url){
 if(request.method!=="GET"||url.origin!==self.location.origin)return false;
 if(request.headers.has("Authorization")||request.headers.has("Range"))return false;
 if(!["script","style","image","font"].includes(request.destination))return false;
 if(!ALLOWED_STATIC_PREFIXES.some(prefix=>url.pathname.startsWith(prefix)))return false;
 if(!/\.(?:css|js|mjs|png|svg|webp|woff2?)$/i.test(url.pathname))return false;
 return true;
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
 if(!isSafeStaticRequest(request,url))return;
 event.respondWith((async()=>{
  let cache;
  try{cache=await caches.open(STATIC_CACHE);}
  catch{return fetch(request);}
  const hit=(await cache.match(request))||(await caches.match(request));
  if(hit)return hit;
  const response=await fetch(request);
  if(response.ok&&response.type==="basic"&&
    !/\b(?:private|no-store)\b/i.test(response.headers.get("cache-control")||"")){
    // Fail open when a device is out of storage: don't break network access.
    try{
      await cache.put(request,response.clone());
      const keys=await cache.keys();
      if(keys.length>STATIC_MAX_ENTRIES)
       await Promise.all(keys.slice(0,keys.length-STATIC_MAX_ENTRIES).map(key=>cache.delete(key)));
    }catch{/* CacheStorage is optional and quota is device-dependent. */}
  }
  return response;
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
