const test = require("node:test");
const assert = require("node:assert/strict");
const { loadHandler } = require("./helpers.cjs");

test("recurring maintenance publishes without scanning or deleting storage", async () => {
  const calls = [];
  const handler = loadHandler("automation-maintenance", {
    rpc: async name => { calls.push(name); return { data: { published: 2 }, error: null }; },
    from() { throw new Error("A recurring job must not infer orphans from message scans"); },
    storage: { from() { throw new Error("Storage mutation is outside this job"); } }
  });
  await handler();
  assert.deepEqual(calls, ["process_automation_tick"]);
});

test("maintenance reports a failed automation tick for monitoring and retry", async () => {
  const error = new Error("database unavailable");
  await assert.rejects(loadHandler("automation-maintenance", { rpc: async () => ({ error }) }), /database unavailable/);
});

test("unconfigured maintenance fails before accessing the database", async () => {
  await assert.rejects(loadHandler("automation-maintenance", {}, { env: { SUPABASE_SERVICE_ROLE_KEY: "" } }), /not configured/);
});
