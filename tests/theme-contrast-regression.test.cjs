const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const read = relative => fs.readFileSync(path.resolve(__dirname, "..", relative), "utf8");

test("dark-theme account, notification, and author cards use matching surface and foreground tokens", () => {
  const css = read("assets/css/base.css");
  for (const selector of [".notification-item", ".auth-card", ".author-card"]) {
    const offset = css.indexOf(selector + " {");
    assert.ok(offset >= 0, selector + " exists");
    const block = css.slice(offset, css.indexOf("}", offset) + 1);
    assert.match(block, /background:\s*var\(--color-surface/, selector + " has theme-aware background");
    assert.match(block, /color:\s*var\(--color-text/, selector + " has theme-aware foreground");
    assert.doesNotMatch(block, /background:\s*rgba\(255,\s*255,\s*255/, selector + " must not force white in dark mode");
  }
  const tokens = read("assets/css/variables.css");
  assert.match(tokens, /:root\[data-theme="dark"\]/);
  assert.match(tokens, /--color-surface:\s*#182a32/);
  assert.match(tokens, /--color-text:\s*#f1f3f6/);
});

test("notification help and profile notification settings display Blipmood branding", () => {
  const notices = read("assets/js/notifications-ui.js");
  const profile = read("profile.html");
  assert.match(notices, /Allow browser notifications when a Blipmood tab/);
  assert.match(profile, /Optional device notifications while Blipmood is open/);
  assert.doesNotMatch(notices, /when a Timzee tab/);
});

test("comment notification validator and community reply trigger are narrow database fixes", () => {
  const sql=read("supabase/migrations/20261026220612_repair_comment_notifications_and_community_reply_guard.sql");
  assert.match(sql, /parent_reply\.id=new\.reply_to/);
  assert.doesNotMatch(sql, /old\.id=new\.reply_to/);
  assert.match(sql, /p\.author_id = new\.user_id/);
  assert.match(sql, /c\.author_id = caller/);
  assert.match(sql, /Comment notification is not backed by an authored comment/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.doesNotMatch(sql, /DISABLE TRIGGER|DISABLE ROW LEVEL SECURITY|DROP POLICY/i);
});
