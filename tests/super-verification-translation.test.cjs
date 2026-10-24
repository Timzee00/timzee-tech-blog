const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const superPanel=fs.readFileSync("super/professional-panel.html","utf8");
const endpoint=fs.readFileSync("netlify/functions/update-user.js","utf8");
const translate=fs.readFileSync("netlify/functions/verified-translate.js","utf8");
const migration=fs.readFileSync("supabase/migrations/20261024174500_super_verification_translation_quota.sql","utf8");
test("super admin can award and change tiers only through reason-audited server function",()=>{
 assert.match(superPanel,/data-user-action="\\$\\{user\\.is_verified \\? "set_tier" : "verify"\\}"/);
 assert.match(superPanel,/25–1800 characters/);
 assert.match(endpoint,/guard\\.role !== "super"/);
 assert.match(endpoint,/admin_manage_verified_identity/);
 assert.match(migration,/request\\.jwt\\.claim\\.role/);
 assert.match(migration,/private\\.admin_verification_audit/);
 assert.match(migration,/FROM PUBLIC,anon,authenticated/);
 assert.match(migration,/p_tier NOT IN \\('silver','gold','platinum'\\)/);
});
test("signed-in standard members get limited translation without bypassing the quota",()=>{
 assert.doesNotMatch(translate,/Translation is currently for verified creators/);
 assert.match(translate,/consume_verified_translation_quota/);
 assert.match(migration,/v_limit integer:=6/);
 assert.match(migration,/v_limit:=18/);
 assert.match(migration,/Translation hourly quota reached/);
});
