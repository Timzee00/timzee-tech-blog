const test = require("node:test");
const assert = require("node:assert/strict");
const { loadHandler, event } = require("./helpers.cjs");
const request = { messages: [{ role: "user", content: "hello" }] };
const database = limit => ({ auth: { getUser: async () => ({ data: { user: { id: "actor" } } }) }, rpc: async () => limit });

test("AI access requires authentication and a positive rate-limit decision", async () => {
  for (const [limit, status] of [[{ data: { allowed: false, retry_after: 30 } }, 429], [{ data: {} }, 503], [{ error: { message: "offline" } }, 503]]) {
    const response = await loadHandler("llm-proxy", database(limit))(event(request));
    assert.equal(response.statusCode, status);
    if (status === 429) assert.equal(response.headers["Retry-After"], "30");
  }
  assert.equal((await loadHandler("llm-proxy", {} )({ ...event(request), headers: {} })).statusCode, 401);
});

test("AI accepts base64 events, bounds output, and supplies a provider timeout", async () => {
  let called = false;
  const handler = loadHandler("llm-proxy", database({ data: { allowed: true } }), { fetch: async (url, options) => {
    called = true; assert.ok(options.signal); assert.equal(JSON.parse(options.body).max_tokens, 4096);
    return { ok: true, text: async () => JSON.stringify({ choices: [{ message: { content: "response" } }] }) };
  } });
  const input = event({ ...request, max_tokens: 999999 });
  input.body = Buffer.from(input.body).toString("base64"); input.isBase64Encoded = true;
  assert.equal((await handler(input)).statusCode, 200); assert.ok(called);
});

test("AI rejects prototype provider names, redacts provider errors and handles timeouts", async () => {
  const db = database({ data: { allowed: true } });
  assert.equal((await loadHandler("llm-proxy", db)(event({ ...request, provider: "constructor" }))).statusCode, 400);
  const failure = await loadHandler("llm-proxy", db, { fetch: async () => ({ ok: false, status: 401, text: async () => "sensitive-provider-diagnostic" }) })(event(request));
  assert.equal(failure.statusCode, 502); assert.ok(!failure.body.includes("sensitive-provider-diagnostic"));
  const timeout = await loadHandler("llm-proxy", db, { fetch: async () => { const error = new Error(); error.name = "TimeoutError"; throw error; } })(event(request));
  assert.equal(timeout.statusCode, 504);
});
