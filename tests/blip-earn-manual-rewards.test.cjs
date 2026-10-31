const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const schema=read("supabase/migrations/20261031142000_blip_earn_manual_review_rewards.sql");
const fixedAudit=read("supabase/migrations/20261031142500_blip_earn_polymorphic_audit_fix.sql");
const fundedAudit=read("supabase/migrations/20261031143000_blip_earn_reward_config_reason_audit.sql");
const api=read("netlify/functions/blip-earn.js");
const admin=read("super/referrals.html");
const member=read("blip-earn.html");
const winners=read("blip-winners.html");
const adminJs=read("assets/js/blip-earn-admin.mjs");
const memberJs=read("assets/js/blip-earn-dashboard.mjs");
const winnersJs=read("assets/js/blip-earn-winners.mjs");

test("Manual funding is separately switched off with zero awards and fixed ₦1000 amount",()=>{
 assert.match(schema,/create table if not exists public\.blip_reward_controls/);
 assert.match(schema,/enabled boolean not null default false/);
 assert.match(schema,/max_awards integer not null default 0 check/);
 assert.match(schema,/max_awards between 0 and 1000/);
 assert.match(schema,/amount_naira integer not null default 1000 check\(amount_naira=1000\)/);
 assert.match(schema,/unique\(referrer_id,milestone_no\)/);
 assert.match(api,/amount_per_ten:1000/);
 assert.match(admin,/id="befAwardCap"/);
 assert.match(admin,/id="befRewardEnabled"/);
 assert.doesNotMatch(api,/paystack|flutterwave|flutterwave|payout_gateway|transferRecipient/i);
});
test("Manual rewards and all their sensitive fields are service-only and RLS closed",()=>{
 for(const table of ["blip_reward_controls","blip_manual_rewards"]){
  assert.match(schema,new RegExp("alter table public\\."+table+" enable row level security","i"));
  assert.match(schema,new RegExp("revoke all on public\\."+table+" from public,anon,authenticated","i"));
 }
 assert.match(schema,/create table if not exists private\.blip_reward_audit/);
 assert.match(fixedAudit,/data_now jsonb:=to_jsonb\(new\)/);
 assert.match(fundedAudit,/set_config\('blip_reward\.change_reason'/);
 assert.match(fundedAudit,/note:=nullif\(current_setting\('blip_reward\.change_reason'/);
 for(const name of ["blip_reward_admin_config","blip_reward_mint","blip_referral_review",
  "blip_reward_member_request","blip_reward_member_consent","blip_reward_mark_paid",
  "blip_reward_publish_winner","blip_reward_review_queue","blip_reward_admin_queue","blip_reward_winners"]){
  assert.match(schema,new RegExp("revoke all on function public\\."+name));
 }
});
test("Genuine referral review checks 3 persisted activity days after attribution, not page opens",()=>{
 assert.match(schema,/count\(distinct day_of_action\)/);
 assert.match(schema,/blip_reward_activity\(p_referred,referral\.created_at\)/);
 assert.match(schema,/active_days'\)::int,0\)<3/);
 assert.match(schema,/engagement_events'\)::int,0\)<3/);
 assert.match(schema,/age<18 or confirmed is null or user_state is distinct from 'active'/);
 assert.match(schema,/referral\.status<>'pending'/);
 assert.match(schema,/select \* into referral from public\.blip_referrals/);
 assert.match(schema,/for update/);
 assert.doesNotMatch(schema,/site_visitors|site_visit_daily|profile_visit_events/);
 assert.match(admin,/three different activity dates/);
});
test("Each 10 qualified referrals creates one capped and idempotent manual award",()=>{
 assert.match(schema,/where r\.referrer_id=p_owner and r\.status='qualified'/);
 assert.match(schema,/1\.\.least\(qualified\/10,1000\)/);
 assert.match(schema,/select \* into cfg from public\.blip_reward_controls where singleton=true for update/);
 assert.match(schema,/if total_count>=cfg\.max_awards/);
 assert.match(schema,/a\.referrer_id=p_owner and a\.milestone_no=milestone/);
 assert.match(schema,/public\.blip_reward_mint\(p_actor,referral\.referrer_id\)/);
 assert.match(admin,/Maximum ₦1,000 awards to fund/);
 assert.match(admin,/₦15,000/);
});
test("Members request only an approved manual reward and never submit private payment details",()=>{
 assert.match(schema,/where id=p_award and referrer_id=p_user for update/);
 assert.match(schema,/p_method not in \('bank','airtime'\)/);
 assert.match(schema,/if award\.status<>'available'/);
 assert.match(schema,/status='requested',delivery_method=p_method/);
 assert.match(api,/action==="member-request"/);
 assert.match(memberJs,/Request manual payment/);
 assert.match(memberJs,/public_consent:consent\.checked/);
 assert.match(member,/Blipmood does not collect bank account numbers through this page/);
 assert.doesNotMatch(api,/account_number|accountNumber|bank_account_number|otp_code|paystack_secret/i);
});
test("Only Super Admin marks completed personal payments, never a client-side payout",()=>{
 assert.match(schema,/function public\.blip_reward_mark_paid/);
 assert.match(schema,/perform private\.blip_reward_require_super\(p_actor\)/);
 assert.match(schema,/award\.status<>'requested'/);
 assert.match(schema,/status='paid',paid_at=now\(\),paid_by=p_actor/);
 assert.match(api,/action==="admin-paid"/);
 assert.match(adminJs,/I have personally paid ₦1,000/);
 assert.match(adminJs,/sends NO money/);
});
test("Published winners require payment and explicit revocable consent, with public aliases only",()=>{
 assert.match(schema,/award\.status<>'paid' or award\.public_consent_at is null/);
 assert.match(schema,/public_alias=case when p_publish then alias_text else null/);
 assert.match(schema,/published_at=case when p_consent then published_at else null/);
 assert.match(schema,/where published_at is not null and status='paid' and public_consent_at is not null/);
 assert.match(schema,/'username',w\.public_alias/);
 assert.match(winners,/<title>Verified Blip Earn Winners/);
 assert.match(winnersJs,/textContent="@"/);
 assert.match(memberJs,/Withdraw winner-list permission/);
 assert.match(admin,/Copy approved winner announcements/);
 assert.match(adminJs,/navigator\.clipboard\.writeText/);
});
test("Verified official payout chat is staff-only, and external winner channel must use HTTPS",()=>{
 assert.match(schema,/p\.role in \('super','admin'\) and p\.account_status='active' and p\.is_verified is true/);
 assert.match(schema,/v_channel !~ '\^https:\/\//);
 assert.match(api,/staff\.data\?\.is_verified===true/);
 assert.match(api,/\/chat\.html\?user=/);
 assert.match(admin,/Official verified staff @username/);
 assert.match(admin,/Winners channel URL \(optional\)/);
 assert.match(winnersJs,/noopener noreferrer/);
});
test("Manual rewards can be paused without removing old awards or losing public consent revocation",()=>{
 assert.match(schema,/if not cfg\.enabled or cfg\.max_awards<1/);
 assert.match(memberJs,/approved awards remain recorded/);
 assert.match(schema,/select \* into award from public\.blip_manual_rewards/);
 assert.match(schema,/public_consent_at=case when p_consent/);
 assert.match(admin,/Existing awards and payment requests remain/);
});
test("New frontend modules parse and required no-duplicate controls exist",()=>{
 for(const file of ["netlify/functions/blip-earn.js","assets/js/blip-earn-admin.mjs",
   "assets/js/blip-earn-dashboard.mjs","assets/js/blip-earn-winners.mjs"]){
  const raw=read(file).replace(/^import[^\n]+;\s*$/gm,"").replace(/^export /gm,"");
  assert.doesNotThrow(()=>new Function(raw),file+" syntax");
 }
 for(const [path,source] of [["super/referrals.html",admin],
  ["blip-earn.html",member],["blip-winners.html",winners]]){
  const ids=[...source.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length,path+" duplicate IDs");
  assert.match(source,/<meta name="viewport"/);
 }
});
