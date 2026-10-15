const test = require("node:test");
const assert = require("node:assert/strict");
test("only Netlify preview deployments get a noindex response header", async () => {
  const { previewIndexingHeaders } = await import("../scripts/preview-indexing.mjs");
  for (const context of ["deploy-preview", "branch-deploy"]) assert.match(previewIndexingHeaders(context), /X-Robots-Tag: noindex/);
  for (const context of ["production", "dev", undefined, ""]) assert.equal(previewIndexingHeaders(context), "");
});
