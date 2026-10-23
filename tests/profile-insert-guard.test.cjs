const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const sql=fs.readFileSync("supabase/migrations/20261023225101_guard_profile_insert_privileged_fields.sql","utf8");
test("privileged profile insert guard is attached without removing update guard",()=>{
  assert.match(sql,/CREATE TRIGGER protect_profile_privileged_insert/);
  assert.match(sql,/BEFORE INSERT ON public\.profiles/);
  assert.match(sql,/EXECUTE FUNCTION public\.protect_profile_privileged_fields\(\)/);
  assert.doesNotMatch(sql,/DROP TRIGGER\s+protect_profile_privileged_fields/i);
});
test("initial privileged profile fields are rejected",()=>{
  for(const field of [
    "new.role", "new.is_verified", "new.verification_tier",
    "new.account_status", "new.verified_at","new.verification_expires_at",
    "new.points","new.level","new.is_featured","new.is_staff_pick"
  ])assert.ok(sql.includes(field),field+" missing");
  assert.match(sql,/new\.id is distinct from \(select auth\.uid\(\)\)/);
  assert.match(sql,/tg_op = 'INSERT'/);
});
