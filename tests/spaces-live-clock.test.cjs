const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const script=fs.readFileSync("assets/js/live-spaces.mjs","utf8");
const markup=fs.readFileSync("spaces.html","utf8");
const styles=fs.readFileSync("assets/css/live-spaces.css","utf8");

const start=script.indexOf("function spaceClockAt(");
const end=script.indexOf("let spaceClockTicker=",start);
assert.ok(start!==-1&&end>start,"Clock math remains independently testable");
const helpers=vm.runInNewContext(
 "(function(){"+script.slice(start,end)+";return {spaceClockAt,formatSpaceClock};})()",
 {},{timeout:1500}
);
const {spaceClockAt,formatSpaceClock}=helpers;
const started="2026-10-27T15:04:10.000Z";
const t=Date.parse(started);
const room={status:"live",starts_at:started,max_duration_minutes:30};

test("the elapsed clock ticks from the real start, not its configured max duration",()=>{
 assert.equal(formatSpaceClock(spaceClockAt(room,t).elapsedSeconds),"00:00");
 assert.equal(formatSpaceClock(spaceClockAt(room,t+1000).elapsedSeconds),"00:01");
 assert.equal(formatSpaceClock(spaceClockAt(room,t+69000).elapsedSeconds),"01:09");
 assert.equal(formatSpaceClock(spaceClockAt(room,t+181000).elapsedSeconds),"03:01");
 assert.equal(formatSpaceClock(spaceClockAt(room,t+600000).elapsedSeconds),"10:00");
});

test("time left counts down each second and clamps at zero",()=>{
 assert.equal(formatSpaceClock(spaceClockAt(room,t).remainingSeconds),"30:00");
 assert.equal(formatSpaceClock(spaceClockAt(room,t+1000).remainingSeconds),"29:59");
 assert.equal(formatSpaceClock(spaceClockAt(room,t+599000).remainingSeconds),"20:01");
 assert.equal(formatSpaceClock(spaceClockAt(room,t+1799000).remainingSeconds),"00:01");
 assert.equal(formatSpaceClock(spaceClockAt(room,t+1800000).remainingSeconds),"00:00");
 assert.equal(spaceClockAt(room,t+1800000).expired,true);
 assert.equal(spaceClockAt(room,t+1802000).remainingSeconds,0);
});

test("tab suspension and refresh recover actual wall-clock time immediately",()=>{
 const first=spaceClockAt(room,t+3000);
 const next=spaceClockAt(room,t+905000);
 assert.equal(first.elapsedSeconds,3);
 assert.equal(next.elapsedSeconds,905,"tab waking should not merely add one second");
 assert.equal(formatSpaceClock(next.elapsedSeconds),"15:05");
 assert.equal(formatSpaceClock(next.remainingSeconds),"14:55");
});

test("scheduled, ended, unavailable and malformed rooms do not show a live timer",()=>{
 assert.equal(spaceClockAt({...room,status:"scheduled"},t),null);
 assert.equal(spaceClockAt({...room,status:"ended"},t),null);
 assert.equal(spaceClockAt({...room,starts_at:"not a date"},t),null);
 assert.equal(spaceClockAt(null,t),null);
});

test("future start, hour-long Spaces and long elapsed values format safely",()=>{
 assert.equal(formatSpaceClock(spaceClockAt(room,t-350).elapsedSeconds),"00:00");
 assert.equal(formatSpaceClock(spaceClockAt(room,t-350).remainingSeconds),"30:01");
 const hour={...room,max_duration_minutes:60};
 assert.equal(formatSpaceClock(spaceClockAt(hour,t).remainingSeconds),"1:00:00");
 assert.equal(formatSpaceClock(spaceClockAt(hour,t+3600000).elapsedSeconds),"1:00:00");
 assert.equal(formatSpaceClock(spaceClockAt(hour,t+3600000).remainingSeconds),"00:00");
 assert.equal(formatSpaceClock(3599),"59:59");
 assert.equal(formatSpaceClock(3601),"1:00:01");
});

test("clock is live, accessible and independent from network polling",()=>{
 for(const id of ["spaceClock","spaceElapsed","spaceRemaining"]){
  assert.match(markup,new RegExp('id="'+id+'"'));
 }
 assert.match(markup,/role="timer" aria-label="Elapsed live time"/);
 assert.match(markup,/role="timer" aria-label="Time remaining"/);
 assert.match(script,/setInterval\(updateSpaceClock,1000\)/);
 assert.match(script,/state\.room=result\.data;renderDetail\(\);startSpaceClock\(\)/);
 assert.match(script,/window\.addEventListener\("visibilitychange"/);
 assert.match(script,/window\.addEventListener\("pageshow"/);
 assert.match(script,/window\.addEventListener\("pagehide",\(\)=>\{stopSpaceClock\(\)/);
 assert.match(script,/await leave\(\);stopSpaceClock\(\);state\.roomId=null/);
 assert.match(styles,/\.space-live-clock/);
 assert.match(styles,/font-variant-numeric:tabular-nums/);
 assert.match(styles,/@media\(max-width:700px\)/);
 assert.match(styles,/@media\(prefers-reduced-motion:reduce\)/);
 const ids=[...markup.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
 assert.equal(ids.length,new Set(ids).size,"all HTML IDs must stay unique");
 const js=script.replace(/^import[\s\S]*?from\s+"[^"]+";\s*$/gm,"");
 assert.doesNotThrow(()=>new Function(js));
});
