const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const read=path=>fs.readFileSync(path,"utf8");
const source=read("assets/js/verified-identity.mjs").replace(/^export\s+/gm,"");
const sandbox={};
vm.runInNewContext(source+"\nthis.identity={FRAME_OPTIONS,verifiedName,verificationBadge,verifiedLevel,verifiedFrameStyle};",sandbox);
const identity=sandbox.identity;
const sql=read("supabase/migrations/20261029133242_blipmood_identity_recognition_20261029.sql");
const sqlFrames=read("supabase/migrations/20261029133351_expand_verified_frame_styles_20261029.sql");
const sqlReview=read("supabase/migrations/20261029133742_audited_organization_review_20261029.sql");
test("verification badges stay distinct: former Silver Blue, Gold, Platinum, government Grey",()=>{
 const badges=[
  {tier:"silver",file:"blipmood-verified-blue.svg",label:"Blue Verified Individual"},
  {tier:"gold",file:"timzee-verified-gold.svg",label:"Gold Verified Creator"},
  {tier:"platinum",file:"timzee-verified-platinum.svg",label:"Platinum Verified Creator"},
  {tier:"business",file:"timzee-verified-business.svg",label:"Gold Verified Organization"}
 ];
 for(const example of badges){
  const html=identity.verificationBadge({is_verified:true,verification_tier:example.tier});
  assert.ok(html.includes(example.file),example.tier+" correct artwork");
  assert.ok(html.includes(example.label),example.tier+" correct explanation");
 }
 const govt=identity.verificationBadge({is_verified:true,verification_tier:"gold",official_badge_kind:"government"});
 assert.match(govt,/blipmood-verified-government\.svg/);
 assert.match(govt,/Grey Verified Government/);
 assert.equal(identity.verificationBadge({is_verified:false,verification_tier:"platinum"}),"");
});
test("named frames and badges remain escaped when a malicious display name is supplied",()=>{
 const html=identity.verifiedName("<svg onload=alert(1)>",{is_verified:true,verification_tier:"silver",
  blipmoodOrganization:{name:'<img src=x onerror=alert(1)>',title:"Designer",logo_url:"javascript:alert(1)"}
 });
 assert.doesNotMatch(html,/<svg|<img src=x/i);
 assert.match(html,/&lt;svg/);
 assert.match(html,/data-org-label/);
 assert.ok(Array.from(identity.FRAME_OPTIONS,x=>x.id).includes("nameplate"));
 assert.ok(Array.from(identity.FRAME_OPTIONS,x=>x.id).includes("constellation"));
 assert.ok(Array.from(identity.FRAME_OPTIONS,x=>x.id).includes("crest"));
 assert.match(read("assets/css/verified-identity.css"),/tz-frame-name-ribbon/);
});
test("new identity relations are additive, private writes require super, with audit",()=>{
 for(const table of ["identity_organizations","identity_affiliations","identity_appointments","identity_awards"]){
  assert.match(sql,new RegExp("create table if not exists public\\."+table));
  assert.match(sql,new RegExp("alter table public\\."+table+" enable row level security"));
  assert.match(sql,new RegExp("create trigger "+table+"_audit"));
 }
 assert.match(sql,/has_role_secure\('super'\)/);
 assert.match(sql,/private\.identity_decision_audit/);
 assert.match(sql,/auth\.uid\(\)/);
 assert.match(sql,/accept_identity_affiliation/);
 assert.match(sql,/organization_id uuid not null references public\.identity_organizations/);
 assert.match(sqlReview,/length\(btrim|char_length\(btrim/);
 assert.match(sqlReview,/review_identity_organization/);
 assert.match(sqlFrames,/constellation.*crest.*nameplate/);
 assert.doesNotMatch(sql,/drop table public\.profiles/i);
});
test("profile transparency and awards are optional, bounded, and use server-approved records",()=>{
 const html=read("profile.html"),script=read("assets/js/profile.js");
 assert.match(html,/id="profileTransparency"/);
 assert.match(html,/id="profileFrameName"/);
 assert.match(script,/blipmood_public_identity/);
 assert.match(script,/void loadIdentityExtras\(\)/);
 assert.match(script,/catch\(error\)/);
 assert.match(script,/slice\(0,8\)/);
 assert.match(script,/accept_identity_affiliation/);
 assert.match(script,/identityExtras\?\.awards/);
 assert.match(script,/profile-action-more/);
});
test("super admin actions are gated server-side and don't grant moderator rights",()=>{
 const js=read("assets/js/identity-recognition-admin.mjs");
 const html=read("super/identity-recognition.html");
 assert.match(js,/has_role_secure/);
 assert.match(js,/p_role:"super"/);
 assert.match(js,/review_identity_organization/);
 assert.match(js,/identity_appointments/);
 assert.match(js,/identity_awards/);
 assert.match(html,/Identity & Recognition Center/);
 assert.match(read("super/professional-panel.html"),/identity-recognition\.html/);
 assert.doesNotMatch(js,/\.update\(\{role:/);
});
test("blue verification is a free reviewed application, never a self-issued verified status",()=>{
 const html=read("verify.html");
 assert.match(html,/Earn Blue Verification/);
 assert.match(html,/Verification application and review are free/);
 assert.match(html,/verification_applications/);
 assert.doesNotMatch(html,/\.update\(\{is_verified:\s*true/);
});

test("approved company affiliations are copied into public profile batches without N+1 requests",()=>{
 const migration=read("supabase/migrations/20261029134835_identity_affiliation_public_batch_cache.sql");
 const renderer=read("assets/js/verified-identity.mjs");
 const data=read("assets/js/data.js");
 for(const field of ["primary_org_name","primary_org_logo_url","primary_org_title"]){
  assert.match(migration,new RegExp(field));
  assert.match(renderer,new RegExp(field));
  assert.match(data,new RegExp(field));
 }
 assert.match(renderer,/blipmoodOrganization/);
 assert.match(migration,/refresh_public_affiliation/);
 assert.match(migration,/status='active'/);
 assert.match(migration,/o.status='verified'/);
 assert.match(renderer,/for\(let start=0;start<missing.length;start\+=80\)/);
});
test("Advisor applications cannot self-approve and reviewers are audited",()=>{
 const migration=read("supabase/migrations/20261029135139_identity_advisor_applications_review.sql");
 const portal=read("advisor.html");
 const portalJs=read("assets/js/advisor-applications.mjs");
 const admin=read("assets/js/identity-recognition-admin.mjs");
 for(const phrase of ["enable row level security","Advisor applicants submit only pending requests","Only super reviews Advisor requests","review_identity_advisor","for update"]){
  assert.ok(migration.toLowerCase().includes(phrase.toLowerCase()),"Missing: "+phrase);
 }
 assert.match(migration,/user_id=\(select auth.uid\(\)\)/);
 assert.match(migration,/reviewed_by is null/);
 assert.match(migration,/grant execute on function public.review_identity_advisor/);
 assert.match(portal,/Become a Blipmood Advisor/);
 assert.match(portalJs,/identity_advisor_applications/);
 assert.match(admin,/review_identity_advisor/);
 assert.match(read("super/identity-recognition.html"),/id="advisorReviewQueue"/);
});
test("award, affiliation and Advisor notifications occur only on database changes",()=>{
 const migration=read("supabase/migrations/20261029135612_identity_review_notifications.sql");
 assert.match(migration,/after insert or update of status/);
 assert.match(migration,/public.emit_user_notification/);
 assert.match(migration,/advisor_decision/);
 assert.match(migration,/recognition_awarded/);
 assert.match(migration,/affiliation_invite/);
});

test("Grey status is audited and is not self-assignable; sparkle is removed",()=>{
 const sql=read("supabase/migrations/20261029160303_official_grey_verified_badges_20261029.sql");
 const css=read("assets/css/verified-identity.css");
 const html=read("super/identity-recognition.html");
 assert.match(sql,/identity_official_designations/);
 assert.match(sql,/enable row level security/);
 assert.match(sql,/has_role_secure\('super'\)/);
 assert.match(sql,/private\.audit_identity_change/);
 assert.match(sql,/official_badge_kind/);
 assert.match(css,/\.profile-page \.profile-avatar-wrap\.tz-frame::before\{content:none/);
 assert.match(html,/id="governmentCreate"/);
});
test("one delegated profile navigation handler covers names and portraits",()=>{
 const helper=read("assets/js/verified-identity.mjs");
 const profile=read("profile.html");
 const nav=read("assets/js/nav.js");
 assert.match(helper,/data-user-profile-id/);
 assert.match(helper,/document\.addEventListener\("click",navigateFromIdentity,true\)/);
 assert.match(helper,/closest\?\.\("\[data-identity-label\]/);
 assert.match(profile,/profileAvatarLink/);
 assert.match(nav,/siteMenuUser.*href="\/profile\.html"/);
});


test("official identity events are strictly authorized, without allowing arbitrary cross-user alerts",()=>{
 const migration=read("supabase/migrations/20261030223000_identity_notification_validator_fix.sql");
 for(const kind of ["advisor_appointment","appointment_revoked","affiliation_invite","recognition_awarded","advisor_decision"])
   assert.match(migration,new RegExp(kind));
 assert.match(migration,/private\.identity_notification_authorized/);
 assert.match(migration,/has_role_secure\('super'\)/);
 assert.match(migration,/record_id/);
 assert.match(migration,/Unsupported notification type cannot target another user/);
 assert.match(migration,/Notification is not backed by a pending friend request/);
});
test("identity emails are server-enqueued, held for upgrade, and revalidated before Brevo",()=>{
 const migration=read("supabase/migrations/20261030230000_identity_transactional_email_delivery.sql");
 const handshake=read("supabase/migrations/20261030234000_identity_email_worker_rollout_handshake.sql");
 const worker=read("netlify/functions/email-worker.js");
 const settings=read("assets/js/settings-page.js");
 const html=read("settings.html");
 assert.match(migration,/email_jobs_template_check/);
 assert.match(migration,/private\.enqueue_identity_update_email/);
 assert.match(migration,/identity_updates boolean not null default true/);
 assert.match(migration,/next_attempt_at/);
 assert.match(migration,/'infinity'::timestamptz/);
 assert.match(migration,/can_send_identity_update/);
 assert.match(migration,/private\.email_suppressions/);
 assert.match(handshake,/current_setting\('role',true\) is distinct from 'service_role'/);
 assert.match(handshake,/next_attempt_at=now\(\)/);
 assert.match(worker,/activate_identity_email_dispatch/);
 assert.match(worker,/can_send_identity_update/);
 assert.match(worker,/if\(current\.data!==true\)/);
 assert.match(worker,/identityAction\?\.subject/);
 assert.match(settings,/identity_updates/);
 assert.match(html,/data-email-notification="identity_updates"/);
});
