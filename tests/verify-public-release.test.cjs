const test = require("node:test");
const assert = require("node:assert/strict");
const mod = import("../scripts/verify-public-release.mjs");
const good = { commit: "a".repeat(40), asset_version: "b".repeat(16) };
test("buyer release manifest must identify the exact deployed commit", async () => {
  const { validateRelease } = await mod;
  assert.equal(validateRelease(good, good.commit), "");
  assert.match(validateRelease(good, "c".repeat(40)), /does not match/);
  assert.match(validateRelease({ ...good, commit: "unknown" }), /invalid release commit/);
});
test("preview gate requires HTTP noindex AND crawling disallowed", async () => {
  const { checkPreviewIndexing, isPreviewHostname } = await mod;
  const headers = new Headers({ "x-robots-tag": "noindex, nofollow, noarchive" });
  assert.equal(checkPreviewIndexing(headers, "User-agent: *\nDisallow: /\n"), "");
  assert.match(checkPreviewIndexing(headers, "User-agent: *\nAllow: /\n"), /robots/);
  assert.match(checkPreviewIndexing(new Headers(), "Disallow: /"), /X-Robots-Tag/);
  assert.equal(isPreviewHostname("deploy-preview-4--blipmood.netlify.app"), true);
  assert.equal(isPreviewHostname("blipmood.netlify.app"), false);
});


test("public release gate verifies reachable pages, health and release identity without writes", async () => {
  const { createServer } = require("node:http");
  const { once } = require("node:events");
  const { checkSite } = await mod;
  let failures = false;
  const server = createServer((req, res) => {
    if (failures && req.url === "/chat.html") { res.writeHead(404); res.end("missing"); return; }
    if (req.url === "/release.json") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(good)); return;
    }
    if (req.url === "/health") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status:"ok", database:"ok" })); return;
    }
    res.setHeader("content-type", "text/html");
    res.end("<!doctype html><title>Test-only page</title>");
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + server.address().port;
  try {
    const healthy = await checkSite(origin, good.commit);
    assert.equal(healthy.ok, true, JSON.stringify(healthy.failures));
    failures = true;
    const missing = await checkSite(origin, good.commit);
    assert.equal(missing.ok, false);
    assert.ok(missing.failures.some(item => item.includes("chat.html")));
  } finally {
    server.close();
    await once(server, "close");
  }
});
