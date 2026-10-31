const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const shell=read("assets/js/site-shell.js");
const app=read("assets/js/app.js");

function optionalEffectsForDevice(mobile){
 const a=shell.indexOf("function scheduleDecorativeBrand() {");
 const b=shell.indexOf("if(typeof window!==\"undefined\")",a);
 assert.ok(a>=0&&b>a,"noncritical enhancement functions must be isolated");
 const code=shell.slice(a,b);
 const timers=[];
 const win={
  matchMedia:query=>({matches:mobile && query.includes("max-width")}),
  setTimeout:(callback,delay)=>{timers.push({callback,delay});return timers.length;},
  addEventListener:()=>{}
 };
 const doc={
  readyState:"complete",visibilityState:"visible",documentElement:{dataset:{}},
  querySelector:()=>null
 };
 const navigator={connection:{effectiveType:"4g",saveData:false},deviceMemory:mobile?2:8};
 const localStorage={getItem:()=>null};
 const effects=new Function("window","document","navigator","localStorage","scheduleIdle",
   code+"; return {scheduleDecorativeBrand,scheduleHomeCampaign};")(win,doc,navigator,localStorage,()=>{});
 effects.scheduleDecorativeBrand();
 effects.scheduleHomeCampaign();
 return timers;
}

test("mobile homepage performs no automatic intro, welcome or heavy layered logo startup",()=>{
 const timers=optionalEffectsForDevice(true);
 assert.equal(timers.length,0,"mobile must preserve critical render without background decoration");
 assert.match(shell,/if\(currentSitePath\(\)==="index.html"\)scheduleHomeCampaign\(\)/);
 assert.match(shell,/scheduleIdle\(\(\)=>\{/);
 assert.match(shell,/import\("\.\/privacy-consent\.js"\)/);
 assert.match(shell,/if\(!constrained\)afterFirstPaint/);
 assert.match(shell,/Replay intro/);
 assert.match(shell,/playIntro\(\{force:true\}\)/);
});

test("desktop cinematic and animated wordmark wait until after load, not first paint",()=>{
 const timers=optionalEffectsForDevice(false);
 assert.deepEqual(timers.map(x=>x.delay),[7000,6500]);
 assert.match(shell,/userInteracted\|\|document\.visibilityState/);
 assert.match(shell,/#timzee-consent-banner\.is-visible/);
 assert.match(shell,/scheduleIdle\(\(\)=>void import\("\.\/animated-brand\.mjs"\)/);
});

test("secondary profile artwork does not compete with the main page hero",()=>{
 assert.match(app,/alt="member avatar" width="48" height="48" loading="lazy" decoding="async" fetchpriority="low"/);
 assert.match(app,/class="post-card-cover"[\s\S]*?loading="lazy" decoding="async"/);
 const html=read("index.html");
 assert.match(html,/data-bm-logo="emblem"[^>]*fetchpriority="high" loading="eager"/);
 assert.match(read("scripts/build-site.mjs"),/optimizeHomeHero\(contents,assetVersion\)/);
});
