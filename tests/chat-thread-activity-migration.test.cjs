const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path");
test("thread activity migration matches UUID only after validating sender and membership",()=>{
  const sql=fs.readFileSync(path.join(__dirname,"../docs/sql/review-only-chat-thread-activity-v2.sql"),"utf8");
  assert.match(sql,/auth\.uid\(\) IS DISTINCT FROM NEW\.sender_id/);
  assert.match(sql,/target_uuid := NEW\.thread_id::uuid/);
  assert.match(sql,/WHERE t\.id = target_uuid/);
  assert.match(sql,/cm\.user_id = NEW\.sender_id/);
  assert.doesNotMatch(sql,/WHERE id = NEW\.thread_id/);
});
