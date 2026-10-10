const test = require("node:test");
const assert = require("node:assert/strict");
const load = import("../assets/js/single-flight.mjs");

test("concurrent authentication lookups share one request", async () => {
  const { singleFlight } = await load;
  let calls = 0;
  let resolve;
  const gate = new Promise((done) => { resolve = done; });
  const run = singleFlight(async () => { calls++; return gate; });
  const a = run(); const b = run(); const c = run();
  await Promise.resolve();
  assert.equal(calls, 1);
  assert.equal(a, b);
  assert.equal(b, c);
  resolve("user");
  assert.deepEqual(await Promise.all([a, b, c]), ["user","user","user"]);
  assert.equal(await run(), "user");
  assert.equal(calls, 2);
});

test("failed lookup is retried instead of poisoning future requests", async () => {
  const { singleFlight } = await load;
  let calls = 0;
  const run = singleFlight(async () => {
    calls++;
    if (calls === 1) throw Error("temporary outage");
    return "recovered";
  });
  await assert.rejects(run(), /temporary outage/);
  assert.equal(await run(), "recovered");
  assert.equal(calls, 2);
});

test("only overlapping invocations are deduplicated", async () => {
  const { singleFlight } = await load;
  let attempts = 0;
  const run = singleFlight(async () => ++attempts);
  assert.equal(await run(), 1);
  assert.equal(await run(), 2);
});
