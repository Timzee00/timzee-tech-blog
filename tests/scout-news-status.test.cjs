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
