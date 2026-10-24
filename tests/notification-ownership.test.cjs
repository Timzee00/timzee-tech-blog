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

test("mobile drawer notification is an accessible full-width row with a visible label and contained count",()=>{
 const nav=fs.readFileSync(path.resolve(__dirname,"../assets/js/nav.js"),"utf8");
 const css=fs.readFileSync(path.resolve(__dirname,"../assets/css/mobile-acceptance-fixes.css"),"utf8");
 assert.ok(nav.includes('bellLabel.textContent = "Notifications"'));
 assert.ok(nav.includes('notifLink.appendChild(bellLabel)'));
 assert.ok(css.includes('.site-menu .auth-actions > .notification-link'));
 assert.ok(css.includes('grid-column:1 / -1'));
 assert.ok(css.includes('.site-menu .notification-link .notif-count'));
 assert.ok(css.includes('#adminLink,#superLink'));
 assert.ok(css.includes('max-height:58px'));
});
