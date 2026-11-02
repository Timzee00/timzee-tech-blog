/* Blipmood PWA: public static shell offline, private content always network-only.
 * Keep the existing opt-in push handler and same-origin notification navigation.
 * This worker never stores HTML user sessions, API results, chats or private media. */
"use strict";
const PWA_BUILD="__BLIPMOOD_ASSET_VERSION__";
const OFFLINE_CACHE="blipmood-offline-"+PWA_BUILD;
const STATIC_CACHE="blipmood-static-"+PWA_BUILD; // obsolete cache, deleted on upgrade
const OFFLINE_PAGE="/offline.html";
// Only cache what's needed to make the offline editor work.
// Install icons remain available online from the manifest without forcing
// extra 192px and 512px downloads during every first-visit setup.
const OFFLINE_SHELL=[
 OFFLINE_PAGE,
 "/app.webmanifest",
 "/assets/brand/blipmood-emblem-light.png"
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

/* Only installed PWAs receive the Android share POST. Keep inbound images,
 * videos and links in local IndexedDB, never in public CacheStorage. */
const SHARE_DB="blipmood-native-shares",SHARE_STORE="pending";
const SHARE_ALLOWED=new Set(["image/jpeg","image/png","image/webp","image/gif","image/heic","image/heif",
 "video/mp4","video/webm","video/quicktime"]);
function storeIncomingShare(row){
 return new Promise((resolve,reject)=>{
  const open=indexedDB.open(SHARE_DB,1);
  open.onupgradeneeded=()=>{
   if(!open.result.objectStoreNames.contains(SHARE_STORE))
    open.result.createObjectStore(SHARE_STORE,{keyPath:"id"});
  };
  open.onerror=()=>reject(open.error||Error("Local storage is unavailable."));
  open.onsuccess=()=>{
   const db=open.result,tx=db.transaction(SHARE_STORE,"readwrite");
   const store=tx.objectStore(SHARE_STORE);
   const cursor=store.openCursor();
   cursor.onsuccess=()=>{
    const entry=cursor.result;
    if(!entry)return;
    if(!Number.isFinite(entry.value?.createdAt)||Date.now()-entry.value.createdAt>86400000)
     entry.delete();
    entry.continue();
   };
   store.put(row);
   tx.oncomplete=()=>{db.close();resolve();};
   tx.onerror=()=>{db.close();reject(tx.error||Error("Unable to save incoming share."));};
   tx.onabort=()=>{db.close();reject(tx.error||Error("Share storage was interrupted."));};
  };
 });
}
async function receiveNativeShare(request){
 try{
  const form=await request.formData();
  const rawFiles=form.getAll("media").filter(item=>item&&typeof item==="object"&&typeof item.size==="number");
  if(rawFiles.length>6)throw Error("Share at most six images or one video at a time.");
  let bytes=0,videos=0;
  for(const file of rawFiles){
   if(!SHARE_ALLOWED.has(String(file.type||"").toLowerCase()))
    throw Error("Only JPEG, PNG, WebP, GIF, HEIC, MP4, WebM and MOV media can be imported.");
   if(file.size<1||file.size>45*1024*1024)throw Error("Each shared file must be under 45 MB.");
   bytes+=file.size;
   if(file.type.startsWith("video/"))videos++;
  }
  if(bytes>45*1024*1024||videos>1||(videos&&rawFiles.length>1))
   throw Error("Choose up to 45 MB of photos or one video.");
  const title=String(form.get("title")||"").slice(0,200);
  const body=String(form.get("text")||"").slice(0,4000);
  const url=String(form.get("url")||"").slice(0,2048);
  if(!title.trim()&&!body.trim()&&!url.trim()&&!rawFiles.length)
   throw Error("No shareable content was received.");
  const id=crypto.randomUUID();
  await storeIncomingShare({id,title,text:body,url,files:rawFiles,createdAt:Date.now(),sentTo:{},uncertainTo:{},attemptIds:{}});
  return Response.redirect(new URL("/share-inbox.html?id="+encodeURIComponent(id),self.location.origin).href,303);
 }catch(error){
  return new Response(
   "<!doctype html><html lang='en'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Share unavailable</title>"+
   "<body style='font:16px system-ui;background:#0d2331;color:white;padding:24px'><h1>Could not receive the share</h1>"+
   "<p>"+(error?.name==="QuotaExceededError"?"Not enough device storage for this share. Free space and try again.":
    "The item was too large, unsupported, or local storage could not save it.")+
   "</p><a style='color:#a0f5e7' href='/share-inbox.html'>Open Blipmood</a></body></html>",
   {status:507,headers:{"content-type":"text/html; charset=utf-8","cache-control":"no-store"}}
  );
 }
}

self.addEventListener("fetch",event=>{
 const request=event.request;
 const incomingUrl=new URL(request.url);
 if(request.method==="POST"&&incomingUrl.origin===self.location.origin&&incomingUrl.pathname==="/share-target"){
  event.respondWith(receiveNativeShare(request));return;
 }
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
