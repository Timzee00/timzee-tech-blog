const test = require("node:test");
const assert = require("node:assert/strict");
const run = "https://deploy-preview-4--timzee-tech-blog.netlify.app";
const prod = "https://timzee-tech-blog.netlify.app";
const mod = import("../assets/js/auth-redirects.mjs");

test("OAuth callbacks remain on the initiating preview origin", async () => {
  const { getAuthRedirectOrigin, makeAuthRedirect } = await mod;
  const origin = getAuthRedirectOrigin(run, prod);
  assert.equal(origin, run);
  assert.equal(makeAuthRedirect(origin, "chat.html?user=abc"), run + "/login.html?next=chat.html%3Fuser%3Dabc");
});

test("email confirmation and recovery use a local login callback", async () => {
  const { makeAuthRedirect } = await mod;
  assert.equal(makeAuthRedirect(prod), prod + "/login.html");
});

test("a malicious next URL cannot escape the site", async () => {
  const { safeAuthNext } = await mod;
  for (const value of ["//evil.example", "https://evil.example/steal", "javascript:alert(1)", "\\\\evil.example", "https:%2f%2fevil.example"]) {
    assert.equal(safeAuthNext(value, run), "index.html");
  }
  assert.equal(safeAuthNext("/chat.html?user=abc", run), "chat.html?user=abc");
});

test("only HTTPS or local development origins are used for callbacks", async () => {
  const { getAuthRedirectOrigin } = await mod;
  assert.equal(getAuthRedirectOrigin("http://untrusted.example", prod), prod);
  assert.equal(getAuthRedirectOrigin("http://127.0.0.1:5173", prod), "http://127.0.0.1:5173");
});
