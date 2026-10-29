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
test("verified users share a blue individual check while organizations retain a separate badge",()=>{
 for(const tier of ["silver","gold","platinum"]){
  const html=identity.verificationBadge({is_verified:true,verification_tier:tier});
  assert.match(html,/blipmood-verified-blue\.svg/);
  assert.match(html,/Blue Verified Individual/);
 }
 const business=identity.verificationBadge({is_verified:true,verification_tier:"business"});
 assert.match(business,/timzee-verified-business\.svg/);
 assert.match(business,/Gold Verified Organization/);
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
