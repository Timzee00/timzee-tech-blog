const test = require("node:test");
const assert = require("node:assert/strict");
const modulePromise = import("../assets/js/notification-links.mjs");
const origin = "https://blipmood.netlify.app";
test("normalizes safe in-app links for notifications", async () => {
  const { safeNotificationPath } = await modulePromise;
  assert.equal(safeNotificationPath("post.html?id=123", origin), "/post.html?id=123");
  assert.equal(safeNotificationPath("/profile.html?tab=videos#gallery", origin), "/profile.html?tab=videos#gallery");
  assert.equal(safeNotificationPath(origin + "/chat.html", origin), "/chat.html");
});
test("rejects external, script, injected attribute and protocol-relative links", async () => {
  const { safeNotificationPath } = await modulePromise;
  for (const raw of [
    'javascript:alert(1)', 'data:text/html,<svg/onload=alert(1)>',
    '//evil.example', 'https://evil.example',
    '/profile.html" onclick="alert(1)',
    '\\\\evil.example', 'https://user:secret@evil.example'
  ]) {
    assert.equal(safeNotificationPath(raw, origin), "", raw);
  }
});
