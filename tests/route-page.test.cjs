const test = require("node:test");
const assert = require("node:assert/strict");
test("clean URLs and legacy .html URLs match the same page", async () => {
  const { pageFileName } = await import("../assets/js/route-page.mjs");
  for (const base of ["chat", "discussion", "ai-chat", "marketplace", "login", "profile", "stories"]) {
    assert.equal(pageFileName("/" + base), base + ".html");
    assert.equal(pageFileName("/" + base + ".html"), base + ".html");
  }
});
test("root, nested and case variants normalize without losing the page", async () => {
  const { pageFileName } = await import("../assets/js/route-page.mjs");
  assert.equal(pageFileName("/"), "index.html");
  assert.equal(pageFileName("/CHAT"), "chat.html");
  assert.equal(pageFileName("/admin/dashboard"), "dashboard.html");
  assert.equal(pageFileName("/chat?source=share"), "chat.html");
  assert.equal(pageFileName("/chat/#messages"), "chat.html");
});
