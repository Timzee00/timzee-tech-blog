const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const sql=fs.readFileSync(path.resolve(__dirname,"../supabase/migrations/20261025111000_extend_comment_intimidation_review.sql"),"utf8");
test("targeted threats and intimidation enter conservative review without automatic bans",()=>{
 for(const signal of ["possible_targeted_threat","possible_targeted_harassment","possible_credential_phishing"])
  assert.ok(sql.includes(signal),"Missing signal "+signal);
 assert.match(sql,/IF new\.automod_score>=65 THEN/);
 assert.match(sql,/new\.status:='pending'/);
 assert.match(sql,/ELSIF new\.automod_score>=35 THEN/);
 assert.doesNotMatch(sql,/UPDATE public\.profiles|DELETE FROM public\.comments|account_status:='banned'/i);
 assert.match(sql,/REVOKE ALL ON FUNCTION private\.classify_comment_for_review/);
});
