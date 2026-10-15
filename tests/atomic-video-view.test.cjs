const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

test("client cannot modify public video counts with a non-atomic update", () => {
  const client = fs.readFileSync(path.join(__dirname, "../assets/js/videos-marketplace.js"), "utf8");
  const counter = client.slice(client.indexOf("export async function incrementVideoView("),client.indexOf("export async function incrementVideoView(")+1100);
  assert.match(counter, /supabase\.rpc\("record_video_view"/);
  assert.doesNotMatch(counter, /\.update\(\{ view_count:/);
  assert.match(counter, /getSession\(\)/);
});

test("proposed server counter is atomic, authenticated and rate-limited per UTC day", () => {
  const sql = fs.readFileSync(path.join(__dirname, "../docs/sql/review-only-atomic-video-view.sql"), "utf8");
  assert.match(sql, /security definer/i);
  assert.match(sql, /viewer is null/);
  assert.match(sql, /on conflict \(user_id, video_id, viewed_on\) do nothing/i);
  assert.match(sql, /view_count = coalesce\(view_count, 0\) \+ 1/i);
  assert.match(sql, /revoke all on function public\.record_video_view\(uuid\) from public, anon/i);
});
