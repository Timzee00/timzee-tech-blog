const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=path=>fs.readFileSync(path,"utf8");
const sql=read("supabase/migrations/20261030040000_blipmood_product_council_foundation.sql");
const page=read("product-council.html");
const js=read("assets/js/product-council.mjs");
const roles=["product_lead","product_manager","product_advisor","community_advisor","community_contributor","beta_tester","research_contributor","design_contributor","launch_reviewer"];
test("additive Council schema reuses existing reviewed identity appointments",()=>{
 assert.match(sql,/alter table public\.identity_appointments/);
 assert.match(sql,/council_has_role/);
 for(const role of roles){
  assert.ok(sql.includes("'"+role+"'"),"SQL missing "+role);
  assert.ok(read("assets/js/profile.js").includes(role),"Profile label missing "+role);
  assert.ok(read("assets/js/identity-recognition-admin.mjs").includes(role),"Admin appointment missing "+role);
 }
 assert.doesNotMatch(sql,/drop table public\.(profiles|public_profiles|identity_organizations)/i);
 assert.doesNotMatch(sql,/update public\.profiles set is_verified/i);
});
test("every new public Council table uses RLS with limited grants",()=>{
 for(const name of ["council_items","council_comments","council_votes","council_beta_enrollments","council_credits"]){
  assert.ok(sql.includes("create table if not exists public."+name),name+" table");
  assert.ok(sql.includes("alter table public."+name+" enable row level security"),name+" RLS");
  assert.ok(sql.includes("revoke all on public."+name+" from anon,authenticated"),name+" grants");
 }
 assert.match(sql,/create table if not exists private\.council_action_audit/);
 assert.match(sql,/revoke all on private\.council_action_audit/);
 assert.match(sql,/public\.council_can_manage/);
 assert.match(sql,/author_id=\(select auth\.uid\(\)\)/);
});
test("users cannot self-issue published work, release decisions or beta approval",()=>{
 assert.match(sql,/and status='proposed' and assignee_id is null and priority=2/);
 assert.match(sql,/status not in \('approved','shipped'\)/);
 assert.match(sql,/and status='invited' and responded_at is null/);
 assert.match(sql,/status in\('accepted','declined'\)/);
 assert.match(sql,/Council item provenance is immutable/);
 assert.match(sql,/Contribution credit provenance is immutable/);
 assert.match(sql,/Only lead approves public credits/);
});
test("UI remains accessible, escapes untrusted content and bounds queries",()=>{
 assert.match(page,/id="pcMain"/);
 assert.match(page,/aria-live="polite"/);
 assert.match(page,/id="pcCreateForm"/);
 assert.match(page,/id="pcCredits"/);
 assert.match(js,/getUser\(\)/);
 assert.match(js,/PAGE=16/);
 assert.match(js,/\.limit\(30\)/);
 assert.match(js,/\.limit\(12\)/);
 assert.match(js,/\.textContent=/);
 assert.doesNotMatch(js,/innerHTML\s*=/);
 assert.match(js,/council_credits/);
 assert.match(js,/council_beta_enrollments/);
});
test("official Blipmood affiliation remains an accepted verified org, never a Council-generated check",()=>{
 const old=read("supabase/migrations/20261029134835_identity_affiliation_public_batch_cache.sql");
 const ui=read("assets/js/verified-identity.mjs");
 const staff=read("super/identity-recognition.html");
 assert.match(old,/a\.status='active' and o\.status='verified'/);
 assert.match(old,/primary_org_logo_url/);
 assert.match(ui,/affiliationBadge\(profile\)/);
 assert.match(ui,/verificationBadge\(profile/);
 assert.match(staff,/blipmood-emblem-light\.png/);
 assert.doesNotMatch(sql,/insert into public\.identity_affiliations/i);
});
