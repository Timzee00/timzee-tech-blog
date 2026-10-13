const test = require("node:test");
const assert = require("node:assert/strict");
const { handler, manualEvent } = require("../netlify/functions/scout-news-manual.js");
test("manual curator gateway strips spoofable scheduled headers", () => {
  const event = manualEvent({ httpMethod:"POST",headers:{"x-nf-event":"schedule",Authorization:"Bearer token"} });
  assert.equal(event.headers["x-nf-event"],undefined);
  assert.equal(event.headers.Authorization,"Bearer token");
});
test("manual curator entry point denies GET without invoking backend", async () => {
  const result = await handler({httpMethod:"GET",headers:{"x-nf-event":"schedule"}});
  assert.equal(result.statusCode,405);
});
