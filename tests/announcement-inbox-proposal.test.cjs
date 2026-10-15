const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const sql=readFileSync(join(__dirname,"../docs/sql/review-only-announcement-inbox.sql"),"utf8");
test("announcement inbox proposal enforces each user's read receipts under RLS",()=>{
  assert.match(sql,/enable row level security/i);
  assert.match(sql,/user_id = \(select auth\.uid\(\)\)/i);
  assert.match(sql,/security invoker/i);
  assert.match(sql,/revoke all on public\.announcement_reads from public, anon/i);
});
test("fanout replacement cannot be mistaken for an already-applied migration",()=>{
  assert.match(sql,/REVIEW-ONLY ARCHITECTURE PROPOSAL/);
  assert.match(sql,/REQUIRED COMPANION MIGRATION/);
  assert.doesNotMatch(sql,/insert into public\.notifications/i);
});
