const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
test("device alerts require explicit opt-in and stay same-origin",()=>{
 const s=fs.readFileSync("assets/js/notifications-ui.js","utf8");
 const html=fs.readFileSync("profile.html","utf8");
 const build=fs.readFileSync("scripts/build-site.mjs","utf8");
 const sw=fs.readFileSync("sw.js","utf8");
 for(const [source,needle] of [[html,'id="deviceAlertsBtn"'],[s,'button.onclick=async()=>'],[s,'Notification.requestPermission()'],[s,'document.visibilityState!=="hidden"'],[s,'navigator.serviceWorker.register("/sw.js")'],[s,'notificationAllowed(note)'],[sw,'notificationclick'],[sw,'parsed.origin!==self.location.origin'],[build,'"sw.js"']]) assert.ok(source.includes(needle),needle);
 assert.ok(!sw.includes("caches.open("));
});

test("lock screen alerts never expose message text and dismissing a toast keeps its inbox unread",()=>{
 const src=require("node:fs").readFileSync(require("node:path").resolve(__dirname,"../assets/js/notifications-ui.js"),"utf8");
 assert.ok(src.includes('showNotification("Blipmood notification"'));
 assert.ok(src.includes('body:"You have a new update. Open Blipmood to review it."'));
 assert.ok(src.includes('close.addEventListener("click", () => { removeToast(toast); })'));
 assert.ok(!src.includes('close.addEventListener("click", () => { markRead('));
});
