/* Site notification worker: no caching and no stored account data. */
self.addEventListener("notificationclick",event=>{
 event.notification.close();
 const input=event.notification.data?.url||"/profile.html?tab=notifications";
 let target;
 try{const parsed=new URL(input,self.location.origin);if(parsed.origin!==self.location.origin)return;target=parsed.href;}
 catch{return;}
 event.waitUntil((async()=>{
  const tabs=await self.clients.matchAll({type:"window",includeUncontrolled:true});
  const tab=tabs.find(c=>{try{return new URL(c.url).origin===self.location.origin}catch{return false}});
  if(tab){await tab.focus();await tab.navigate(target)}
  else await self.clients.openWindow(target);
 })());
});
