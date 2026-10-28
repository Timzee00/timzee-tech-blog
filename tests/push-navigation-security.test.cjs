const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const source=fs.readFileSync("sw.js","utf8");
function workerHarness(existingClients=[]){
  const handlers={},notifications=[],opened=[];
  const self={
    location:{origin:"https://blipmood.netlify.app"},
    addEventListener:(name,handler)=>{handlers[name]=handler;},
    registration:{showNotification:async(title,options)=>{notifications.push({title,options});}},
    clients:{
      matchAll:async()=>existingClients,
      openWindow:async(url)=>{opened.push(url);}
    }
  };
  vm.runInNewContext(source,{self,URL},{timeout:2000});
  const dispatch=async(name,extra={})=>{
    let operation=Promise.resolve();
    const event={waitUntil(p){operation=Promise.resolve(p);},...extra};
    handlers[name](event);
    await operation;
  };
  return {notifications,opened,dispatch};
}
test("push receives an inbox deep link and hides private notification text",async()=>{
  const h=workerHarness();
  await h.dispatch("push",{data:{json:()=>({
    body:"Very private message content",url:"/profile.html?tab=notifications"
  })}});
  assert.equal(h.notifications.length,1);
  assert.equal(h.notifications[0].title,"Blipmood");
  assert.equal(h.notifications[0].options.body,
    "You have a new notification. Open Blipmood to review it.");
  assert.equal(h.notifications[0].options.data.url,
    "https://blipmood.netlify.app/profile.html?tab=notifications");
  assert.doesNotMatch(h.notifications[0].options.body,/Very private/);
});
test("external and javascript notification destinations are never opened",async()=>{
  for(const malicious of ["https://attacker.example/login","javascript:alert(1)","//attacker.example/login"]){
    const h=workerHarness();
    await h.dispatch("push",{data:{json:()=>({url:malicious})}});
    assert.equal(h.notifications[0].options.data.url,
      "https://blipmood.netlify.app/profile.html?tab=notifications");
  }
});
test("clicking a background notification navigates an existing tab to the inbox",async()=>{
  const steps=[],tab={
    url:"https://blipmood.netlify.app/index.html",
    navigate:async(url)=>steps.push(["navigate",url]),
    focus:async()=>steps.push(["focus"])
  };
  const h=workerHarness([tab]);
  let closed=false;
  await h.dispatch("notificationclick",{notification:{
    data:{url:"/profile.html?tab=notifications"},close(){closed=true;}
  }});
  assert.equal(closed,true);
  assert.deepEqual(steps,[
    ["navigate","https://blipmood.netlify.app/profile.html?tab=notifications"],
    ["focus"]
  ]);
  assert.equal(h.opened.length,0);
});
test("click falls back to opening the inbox when no matching tab exists",async()=>{
  const h=workerHarness([{url:"https://other.example/",focus:async()=>{throw Error("wrong")}}]);
  await h.dispatch("notificationclick",{notification:{data:{url:"https://evil.example"},close(){}}});
  assert.deepEqual(h.opened,["https://blipmood.netlify.app/profile.html?tab=notifications"]);
});
test("service worker performs no background caching and supplies a safe URL",()=>{
  assert.match(source,/parsed\.origin!==self\.location\.origin/);
  assert.match(source,/DEFAULT_NOTIFICATION_URL="\/profile\.html\?tab=notifications"/);
  assert.doesNotMatch(source,/caches\.open\(|\.cache\.add/);
});
