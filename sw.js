/* Blipmood push worker: no tracking and no caching. */
"use strict";
self.addEventListener("push",event=>{
  let message={};
  try{message=event.data?event.data.json():{}}catch{message={};}
  const title="Blipmood";
  const body=typeof message.body==="string"?message.body.slice(0,180):"You have new activity.";
  event.waitUntil(self.registration.showNotification(title,{
    body,tag:"blipmood-activity",icon:"/assets/brand/blipmood-emblem-light.png",badge:"/assets/brand/blipmood-emblem-light.png",renotify:false,
    data:{url:"/index.html"}
  }));
});
self.addEventListener("notificationclick",event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const url=new URL("/index.html",self.location.origin).href;
    const windows=await self.clients.matchAll({type:"window",includeUncontrolled:true});
    const existing=windows.find(client=>new URL(client.url).origin===self.location.origin);
    if(existing){await existing.focus();await existing.navigate(url);return;}
    await self.clients.openWindow(url);
  })());
});