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
  assert.equal(isPreviewHostname("deploy-preview-4--timzee-tech-blog.netlify.app"), true);
  assert.equal(isPreviewHostname("timzee-tech-blog.netlify.app"), false);
});
