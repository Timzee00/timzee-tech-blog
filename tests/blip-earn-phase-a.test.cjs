const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const read=file=>fs.readFileSync(file,"utf8");
const sql=read("supabase/migrations/20261031123500_blip_earn_referral_phase_a.sql");
const api=read("netlify/functions/blip-earn.js");
const setup=read("assets/js/member-onboarding.mjs");
const html=read("welcome.html");
const earn=read("blip-earn.html");
const admin=read("super/referrals.html");
const capture=read("assets/js/referral-capture.mjs");
test("Referral launch is off by default and makes no cash or airtime promises",()=>{
 assert.match(sql,/enabled boolean not null default false/);
 assert.match(sql,/values\(true,false,0\)/);
 assert.match(api,/cash_payouts_enabled:\s*false/);
 assert.match(api,/\["issue-code","claim","admin-config"\]/);
 assert.doesNotMatch(api,/action\s*===\s*["'](?:payout|withdraw|credit)["']/i);
 assert.match(earn,/Cash, airtime and payouts have/);
 assert.match(admin,/Turning referrals ON activates invitation tracking, not a ₦1,000 payment promise|Switching referrals ON activates invitation tracking, not a ₦1,000 payment promise/);
});
test("Owner attribution and settings are protected by RLS and service-only SQL RPCs",()=>{
 for(const table of ["blip_referral_settings","blip_referral_codes","blip_referrals"]){
  assert.match(sql,new RegExp("alter table public\\."+table+" enable row level security","i"));
  assert.match(sql,new RegExp("revoke all on public\\."+table+" from public,anon,authenticated","i"));
 }
 for(const name of ["blip_referral_claim","blip_referral_program_status","blip_referral_admin_save","blip_referral_consume_attempt"]){
  assert.match(sql,new RegExp("function public\\."+name));
  assert.match(sql,new RegExp("revoke all on function public\\."+name));
 }
 assert.match(sql,/current_setting\('role',true\) is distinct from 'service_role'/);
 assert.match(sql,/check\(referred_user_id <> referrer_id\)/);
 assert.match(sql,/referred_user_id uuid primary key/);
 assert.match(sql,/owner_id uuid primary key/);
 assert.match(sql,/on conflict\(referred_user_id\) do nothing/);
 assert.match(sql,/for update/);
});
test("Founder can manually pause and add an automatic verified-member cutoff",()=>{
 assert.match(sql,/target_activated_members integer not null default 0/);
 assert.match(sql,/member_onboarding o on o.user_id=u.id and o.completed_at is not null/);
 assert.match(sql,/u.email_confirmed_at is not null/);
 assert.match(sql,/cfg.target_activated_members=0 or activated<cfg.target_activated_members/);
 assert.match(sql,/cfg.target_activated_members>0/);
 assert.match(sql,/current_role is distinct from 'super'/);
 assert.match(sql,/private.blip_referral_settings_audit/);
 assert.match(admin,/id="befEnabled"/);
 assert.match(admin,/id="befTarget"/);
 assert.match(admin,/id="befReason"/);
 assert.match(read("assets/js/blip-earn-admin.mjs"),/action:"admin-config"/);
});
test("Onboarding keeps three stages and optionally accepts short-lived referral codes",()=>{
 assert.equal((html.match(/data-stage="[123]"/g)||[]).length,3);
 assert.match(html,/id="setupReferralSection" hidden/);
 assert.match(html,/id="setupReferralCode"/);
 assert.match(setup,/Number\.isInteger\(age\)\|\|age<18/);
 assert.match(setup,/loadReferralOffer/);
 assert.match(setup,/if\(saved.error\)throw saved.error;[\s\S]*?submitReferralCode/);
 assert.match(setup,/catch\(error\)\{[\s\S]*?Referral attribution deferred/);
 assert.match(capture,/7 \* 24 \* 60 \* 60 \* 1000/);
 assert.match(capture,/^export const validReferralCode/m);
 assert.match(read("login.html"),/src="assets\/js\/referral-capture\.mjs"/);
});
test("Server validates new genuine accounts, self referrals and rate limits",()=>{
 assert.match(sql,/joined_at < now\(\)-interval '14 days'/);
 assert.match(sql,/member_age<18/);
 assert.match(sql,/owner=p_user/);
 assert.match(sql,/owner_created>=joined_at/);
 assert.match(sql,/owner_verified is null/);
 assert.match(sql,/attempts<8/);
 assert.match(api,/randomBytes\(6\)/);
 assert.match(api,/getUserWithTrustedRole/);
 assert.match(api,/requireRole\(db, token, \["super"\]/);
 assert.match(api,/db\.rpc\("blip_referral_consume_attempt"/);
 assert.match(api,/db\.rpc\("blip_referral_claim"/);
 assert.match(api,/db\.rpc\("blip_referral_admin_save"/);
});
test("Responsive member and staff pages exist with working navigation links",()=>{
 assert.match(earn,/<title>Blip Earn/);
 assert.match(earn,/id="beWorkspace"/);
 assert.match(earn,/id="beClaimForm"/);
 assert.match(earn,/@media\(max-width:690px\)/);
 assert.match(admin,/@media\(max-width:710px\)/);
 assert.match(read("assets/js/blipmood-unified-menu.mjs"),/Blip Earn","\/blip-earn\.html"/);
 assert.match(read("super/professional-panel.html"),/href="referrals\.html"/);
 assert.match(earn,/src="assets\/js\/blip-earn-dashboard\.mjs"/);
 assert.match(admin,/src="\.\.\/assets\/js\/blip-earn-admin\.mjs"/);
});
