const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=file=>fs.readFileSync(file,"utf8");
const base="supabase/migrations/";
const migrations=[
 "20261030003709_region_feature_rules_20261030.sql",
 "20261030003807_bounded_video_candidates_and_view_retention_20261030.sql",
 "20261030003837_video_candidates_invoker_rls_read_20261030.sql",
 "20261030004017_platform_capacity_guards_20261030.sql",
 "20261030004339_enforce_region_feature_write_gates_20261030.sql",
 "20261030004436_netlify_observed_geo_region_rules_20261030.sql",
 "20261030004535_geo_feature_fail_closed_unknown_20261030.sql",
 "20261030004752_regional_guard_existing_personalized_feed_20261030.sql"
];
const sql=migrations.map(m=>read(base+m)).join("\n");
test("regional launch defaults preserve existing features and leave monetization disabled",()=>{
 for(const name of ["video_uploads","fyp_recommendations","marketplace","live_spaces","profile_fx"])
  assert.match(sql,new RegExp("'"+name+"','\\*',true,100"));
 assert.match(sql,/'creator_monetization','\*',false,0/);
 assert.match(sql,/rollout_pct between 0 and 100/);
 assert.match(sql,/feature_key,country_code/);
});
test("regional access is server-owned, deterministic, and fails closed for unknown countries",()=>{
 assert.match(sql,/platform_trusted_regions/);
 assert.match(sql,/platform_observed_regions/);
 assert.match(sql,/if region is null and exists/);
 assert.match(sql,/p_feature<>'creator_monetization'/);
 assert.match(sql,/md5\(viewer::text\|\|':'\|\|p_feature\)/);
 assert.match(sql,/has_role_secure\('super'\)/);
 assert.match(sql,/enable row level security/);
 assert.match(sql,/private\.platform_feature_audit/);
 const server=read("netlify/functions/region-check.mjs");
 assert.match(server,/context\?\.geo\?\.country\?\.code/);
 assert.match(server,/supabase\.auth\.getUser\(token\)/);
 assert.match(server,/country_code:country/);
 assert.doesNotMatch(server,/request\.headers\.get\("x-country"/);
 assert.doesNotMatch(read("assets/js/observed-region.mjs"),/SERVICE_ROLE_KEY|process\.env/);
});
test("disabled features are enforced by RLS, upload trigger and personalized ranking",()=>{
 for(const name of ["marketplace","live_spaces","profile_fx","video_uploads"])
  assert.match(sql,new RegExp("blipmood_feature_allowed\\('"+name+"'\\)"));
 assert.match(sql,/as restrictive for insert/);
 assert.match(sql,/storage\.objects/);
 assert.match(sql,/private\.platform_video_upload_gate/);
 assert.match(sql,/blipmood_feature_allowed\('fyp_recommendations'\)/);
});
test("candidate generation and view history retention are bounded and scheduled",()=>{
 assert.match(sql,/created_at desc limit 2000/);
 assert.match(sql,/limit 200/);
 assert.match(sql,/limit 80/);
 assert.match(sql,/limit least\(50,greatest\(1/);
 assert.match(sql,/blipmood-candidate-refresh-15m/);
 assert.match(sql,/blipmood-view-event-prune-daily/);
 assert.match(sql,/viewed_on<cutoff/);
 assert.match(sql,/::date-30/);
 assert.doesNotMatch(sql,/delete from public\.videos/i);
 const client=read("assets/js/video-discovery.mjs");
 assert.match(client,/blipmood_video_feed_ids/);
 assert.match(client,/useQuick/);
 assert.match(client,/cachedFeed|const cache = new Map/);
 assert.match(client,/MAX_CANDIDATES = 50/);
});
test("storage protection validates object ownership, size and safely cleans orphan uploads",()=>{
 assert.match(sql,/max_video_upload_bytes/);
 assert.match(sql,/max_thumbnail_bytes/);
 assert.match(sql,/metadata->>'size'/);
 assert.match(sql,/file_path not like 'videos\/'\|\|new\.user_id/);
 assert.match(sql,/media_budget_bytes/);
 assert.match(sql,/upload_pause_pct/);
 const uploader=read("assets/js/videos-marketplace.js");
 assert.match(uploader,/blipmood_media_upload_policy/);
 assert.match(uploader,/Video too large/);
 assert.match(uploader,/\.remove\(paths\)/);
 assert.match(uploader,/blipmood_feature_allowed/);
});
test("super admin controls are private, on demand and no old content is deleted",()=>{
 const admin=read("assets/js/region-capacity-admin.mjs");
 const page=read("super/region-capacity.html");
 assert.match(admin,/has_role_secure/);
 assert.match(admin,/p_role:"super"/);
 assert.match(admin,/blipmood_capacity_snapshot/);
 assert.match(admin,/platform_feature_rules/);
 assert.match(admin,/platform_trusted_regions/);
 assert.match(page,/Region & Capacity Manager/);
 assert.match(read("super/professional-panel.html"),/region-capacity\.html/);
 assert.match(sql,/Super administrator required/);
 assert.doesNotMatch(sql,/delete from storage\.objects/);
});
