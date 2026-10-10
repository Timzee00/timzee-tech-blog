const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
test("one module owns notification INSERT popups, while announcements remain separate", () => {
  const alerts = fs.readFileSync(path.join(root, "assets/js/notifications-ui.js"), "utf8");
  const announcements = fs.readFileSync(path.join(root, "assets/js/notification-popup.js"), "utf8");
  assert.match(alerts, /table: "notifications"/);
  assert.doesNotMatch(announcements, /table: "notifications"/);
  assert.match(announcements, /table: "announcements"/);
});
