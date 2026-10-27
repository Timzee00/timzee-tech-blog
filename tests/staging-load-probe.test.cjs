const test = require("node:test");
const assert = require("node:assert/strict");
const mod = import("../scripts/staging-load-probe.mjs");
test("rejects production, external and credentialed URLs",async () => {
  const { stagingOrigin } = await mod;
  assert.throws(() => stagingOrigin("https://blipmood.netlify.app"), /Refusing/);
  assert.throws(() => stagingOrigin("https://example.com"), /Refusing/);
  assert.throws(() => stagingOrigin("https://someone:secret@deploy-preview-4--blipmood.netlify.app/"), /origin/);
  assert.equal(stagingOrigin("https://deploy-preview-4--blipmood.netlify.app/"), "https://deploy-preview-4--blipmood.netlify.app");
});
test("limits concurrency and number of requests before staged tests",async () => {
  const { boundedWorkload } = await mod;
  assert.deepEqual(boundedWorkload(5,50),{concurrency:5,count:50});
  assert.throws(() => boundedWorkload(100,100000), /1–20/);
  assert.throws(() => boundedWorkload(5,401), /1–20/);
});
test("reports errors and latency from a mocked read-only transport",async () => {
  const { runProbe } = await mod;
  let requested = 0;
  const fake = async (url, options) => {
    requested++;
    assert.equal(options.method,"GET");
    return { ok:requested!==3,status:requested===3?503:200,async arrayBuffer(){return new ArrayBuffer(12)} };
  };
  const result = await runProbe("http://127.0.0.1:5173",{concurrency:1,count:5},fake);
  assert.equal(result.requests,5);
  assert.equal(result.failure_count,1);
  assert.equal(result.error_rate,20);
  assert.ok(result.latency_ms.p95>=0);
});
