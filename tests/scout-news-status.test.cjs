const test = require("node:test");
const assert = require("node:assert/strict");
const { summarizeScoutHealth } = require("../netlify/functions/_lib/scout-health.cjs");

test("read-only scout status distinguishes never run, failed, and operating", () => {
  const never = summarizeScoutHealth({ settings: { enabled:true, scout_enabled:true }, activeSources:8 });
  assert.equal(never.lastStatus,"never_run");
  assert.equal(never.configurationChecks.hasSources,true);
  const failed = summarizeScoutHealth({ settings:{enabled:true,scout_enabled:true,scout_last_status:"failed"},
    activeSources:8,importedArticles:0,job:{run_count:2,last_failed_at:"2026-10-12T21:57:30Z"} });
  assert.equal(failed.lastRunFailed,true);
  assert.equal(failed.importedArticles,0);
  const success = summarizeScoutHealth({settings:{enabled:true,scout_enabled:true},job:{
    last_failed_at:"2026-10-12T21:00:00Z",last_succeeded_at:"2026-10-13T09:00:00Z",
    last_result:{status:"success"},run_count:3 }});
  assert.equal(success.lastRunFailed,false);
  assert.equal(success.lastStatus,"success");
});
test("disabled curator and no sources are obvious in health results", () => {
  const result=summarizeScoutHealth({settings:{enabled:true,scout_enabled:false},activeSources:0});
  assert.equal(result.enabled,false);
  assert.equal(result.configurationChecks.hasSources,false);
});

test("scout status route requires GET and a bearer token", async () => {
 const { handler } = require("../netlify/functions/scout-news-status.js");
 const wrong = await handler({httpMethod:"POST",headers:{}});
 assert.equal(wrong.statusCode,405);
 const anonymous = await handler({httpMethod:"GET",headers:{}});
 assert.equal(anonymous.statusCode,401);
});


test("stale running curator is not mistaken for successful current automation",()=>{
  const now=Date.parse("2026-10-23T12:00:00Z");
  const stale=summarizeScoutHealth({
    settings:{enabled:true,scout_enabled:true,scout_last_status:"success"},
    activeSources:15,
    job:{last_started_at:"2026-10-15T23:52:34Z",
      last_succeeded_at:"2026-10-15T23:52:34Z",last_result:{status:"success"}},
    lastSourceFetchAt:"2026-10-15T23:52:34Z",now
  });
  assert.equal(stale.lastRunFailed,false);
  assert.equal(stale.lastRunStale,true);
  assert.equal(stale.operationalStatus,"stale");
  assert.equal(stale.needsAttention,true);
  assert.equal(stale.lastSourceFetchAt,"2026-10-15T23:52:34Z");
  const recovered=summarizeScoutHealth({
    settings:{enabled:true,scout_enabled:true},
    activeSources:15,
    job:{last_started_at:"2026-10-23T11:00:00Z",
      last_succeeded_at:"2026-10-23T11:00:00Z",last_result:{status:"success"}},
    now
  });
  assert.equal(recovered.operationalStatus,"healthy");
  assert.equal(recovered.needsAttention,false);
});

test("disabled curator and missing runs are reported distinctly",()=>{
  const now=Date.parse("2026-10-23T12:00:00Z");
  const never=summarizeScoutHealth({
    settings:{enabled:true,scout_enabled:true},activeSources:15,now
  });
  assert.equal(never.operationalStatus,"never_run");
  assert.equal(never.needsAttention,true);
  const disabled=summarizeScoutHealth({
    settings:{enabled:false,scout_enabled:false},activeSources:15,now
  });
  assert.equal(disabled.operationalStatus,"disabled");
  assert.equal(disabled.needsAttention,false);
});


test("curator UI makes stale and failed Scout status explicit",()=>{
  const fs=require("node:fs");
  const source=fs.readFileSync("assets/js/curator-ui.js","utf8");
  assert.match(source,/payload\.operationalStatus/);
  assert.match(source,/stale: "Scout is overdue/);
  assert.match(source,/never_run: "No Scout run has been recorded/);
  assert.match(source,/status\.textContent =/);
  assert.doesNotMatch(source,/payload\.enabled \? "Scout enabled\."/);
});
