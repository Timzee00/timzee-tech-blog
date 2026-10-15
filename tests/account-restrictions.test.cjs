const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const sql=fs.readFileSync(path.join(__dirname,"../docs/sql/review-only-account-restrictions.sql"),"utf8");
test("restriction enforcements are restrictive not permissive",()=>{
 for(const tbl of ["posts","comments","videos","marketplace_items","direct_messages","video_comments","discussion_messages"]){
  assert.match(sql,new RegExp('ON public\\.'+tbl+'\\s+AS RESTRICTIVE FOR INSERT'));
 }
});
test("restriction management does not give write permissions to the client",()=>{
 assert.match(sql,/REVOKE ALL ON public\.account_restrictions FROM anon,authenticated/);
 assert.match(sql,/expires_at > now\(\)/);
});
test("notices and appeals are available to affected users",()=>{
 assert.match(sql,/users_read_own_restrictions/);
 assert.match(sql,/appeals_create_own/);
});
