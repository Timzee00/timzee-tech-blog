const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const sql=fs.readFileSync("supabase/migrations/20261023161314_spaces_actual_start_time_token_alignment.sql","utf8");
test("early scheduled start uses the real live clock for token eligibility and duration",()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.spaces_start\(p_room uuid\)/);
 assert.match(sql,/SET status='live', starts_at=now\(\)/);
 assert.match(sql,/owner_id=\(SELECT auth\.uid\(\)\)/);
 assert.match(sql,/status='scheduled'/);
 assert.match(sql,/starts_at<=now\(\)\+interval '10 minutes'/);
 assert.match(sql,/now\(\)<=starts_at\+make_interval\(mins=>max_duration_minutes\)/);
 assert.match(sql,/RETURN FOUND/);
});
test("token and heartbeat still impose duration and presence checks",()=>{
 const token=fs.readFileSync("netlify/functions/spaces-token.js","utf8");
 assert.match(token,/participant\.state!=="present"/);
 assert.match(token,/now>start\+Number\(room\.max_duration_minutes\|\|30\)\*60000/);
 assert.match(token,/now-lastSeen>120000/);
});
