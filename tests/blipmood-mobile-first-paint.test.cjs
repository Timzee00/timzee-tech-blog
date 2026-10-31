const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const shell=read("assets/js/site-shell.js");
const app=read("assets/js/app.js");

function optionalEffectsForDevice(mobile,{consent=false,seen=false,reduced=false}={}){
 const a=shell.indexOf("function scheduleDecorativeBrand() {");
 const b=shell.indexOf('if(typeof window!=="undefined")',a);
 assert.ok(a>=0&&b>a,"optional features must remain isolated");
 const code=shell.slice(a,b);
 const timers=[],events={},docEvents={},actions=[];
 let consentVisible=consent;
 const win={
  matchMedia:query=>({matches:query.includes("prefers-reduced-motion")?reduced:mobile&&query.includes("max-width")}),
  setTimeout:(callback,delay)=>{timers.push({callback,delay});return timers.length;},
  addEventListener:(event,fn)=>{events[event]=fn;},
  removeEventListener:(event)=>{delete events[event];}
 };
 const doc={
  visibilityState:"visible",
  documentElement:{dataset:{}},
  querySelector:(selector)=>(selector.includes("timzee-consent-banner")&&consentVisible?{}:null),
  addEventListener:(event,fn)=>{docEvents[event]=fn;},
  removeEventListener:(event)=>{delete docEvents[event];}
 };
 const navigator={connection:{effectiveType:"4g",saveData:false},deviceMemory:mobile?2:8};
 const localStorage={getItem:()=>seen?"1":null};
 const effects=new Function("window","document","navigator","localStorage","scheduleIdle",
   code+"; return {scheduleDecorativeBrand,scheduleHomeCampaign};")(win,doc,navigator,localStorage,(task)=>{actions.push(task);});
 effects.scheduleDecorativeBrand();
 effects.scheduleHomeCampaign();
 return {timers,events,actions,clearConsent:()=>{consentVisible=false;}};
}

test("mobile and desktop retain delayed animated name and welcome/intro after first paint",()=>{
 const mobile=optionalEffectsForDevice(true);
 const desktop=optionalEffectsForDevice(false);
 assert.deepEqual(mobile.timers.map(x=>x.delay),[1200,1500]);
 assert.deepEqual(desktop.timers.map(x=>x.delay),[1200,1500]);
 assert.match(shell,/import\("\.\/animated-brand\.mjs"\)/);
 assert.match(shell,/import\("\.\/blipmood-intro\.mjs"\)/);
 assert.match(shell,/import\("\.\/blipmood-welcome\.mjs"\)/);
 assert.doesNotMatch(shell,/if\(window\.matchMedia\?\.\("\(max-width: 900px\)"\)\?\.matches/);
 assert.match(shell,/Replay intro/);
 assert.match(shell,/Replay welcome/);
});

test("cookie consent postpones first-visit animation but resumes after preference decision",()=>{
 const view=optionalEffectsForDevice(true,{consent:true});
 view.timers[1].callback(); // campaign is blocked, not cancelled
 assert.equal(view.actions.length,0);
 assert.equal(typeof view.events["timzee:consent"],"function");
 view.clearConsent();
 view.events["timzee:consent"]();
 assert.equal(view.timers.at(-1).delay,180);
 view.timers.at(-1).callback();
 assert.equal(view.actions.length,1);
});

test("reduced-motion mode avoids automatic animation while keeping manual links",()=>{
 const motion=optionalEffectsForDevice(true,{reduced:true});
 assert.equal(motion.timers.length,0);
 assert.match(shell,/playIntro\(\{force:true\}\)/);
 assert.match(shell,/openWelcome\(\{force:true\}\)/);
});

test("secondary profile artwork does not compete with the main page hero",()=>{
 assert.match(app,/alt="member avatar" width="48" height="48" loading="lazy" decoding="async" fetchpriority="low"/);
 assert.match(app,/class="post-card-cover"[\s\S]*?loading="lazy" decoding="async"/);
 const html=read("index.html");
 assert.match(html,/data-bm-logo="emblem"[^>]*fetchpriority="high" loading="eager"/);
 assert.match(read("scripts/build-site.mjs"),/optimizeHomeHero\(contents,assetVersion\)/);
});
