const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=(f)=>fs.readFileSync(path.join(__dirname,"..",f),"utf8");
test("Super Admin provides scoped search, pagination and admin promotion",()=>{
 const source=root("super/professional-panel.html");
 for(const id of ["superPostSearch","superPostStatus","superPostNext","superPostPrev","superUserSearch","superUserNext","superUserPrev","promoteAdminForm","trafficRange"])
  assert.match(source,new RegExp('id="'+id+'"'));
 assert.match(source,/range\(\(adminPager\.postPage-1\)\*12,adminPager\.postPage\*12-1\)/);
 assert.match(source,/search-staff-users/);
 assert.match(source,/site-traffic-report/);
});
test("Staff lookup is role restricted and bounded to 12 results per page",()=>{
 const source=root("netlify/functions/search-staff-users.js");
 assert.match(source,/requireRole\(db,token,\["admin","super"\]/);
 assert.match(source,/const size=12/);
 assert.match(source,/count:"exact"/);
});
test("Admin promotion cannot demote a super administrator",()=>{
 const source=root("netlify/functions/create-admin.js");
 assert.match(source,/existingProfile\.role==="super"/);
 assert.match(source,/auth\.admin\.getUserById/);
 assert.doesNotMatch(source,/while \(page <= 5\)/);
});
test("Visit metrics distinguish refreshes from unique browsers, only with opt-in",()=>{
 const sql=root("docs/sql/review-only-site-analytics.sql");
 const collector=root("assets/js/visitor-analytics.js");
 const endpoint=root("netlify/functions/site-visit.js");
 assert.match(sql,/primary key\(day,visitor_hash\)/);
 assert.match(sql,/pageviews=public\.site_visit_daily\.pageviews\+1/);
 assert.match(collector,/hasOptionalCookieConsent\("measurement"\)/);
 assert.match(endpoint,/createHmac\("sha256",secret\)/);
 assert.match(sql,/grant execute on function public\.site_traffic_report\(integer\) to service_role/);
});
test("Request inbox supports full details and replies, rather than truncated rows alone",()=>{
 const source=root("assets/js/admin.js");
 assert.match(source,/function inspectRequest/);
 assert.match(source,/showModal\(\)/);
 assert.match(source,/Reply with Brevo/);
});

test("Consent-based traffic tracking retries transient failures and reports configuration faults",()=>{
 const collector=root("assets/js/visitor-analytics.js");
 const report=root("netlify/functions/site-traffic-report.js");
 assert.match(collector,/if\(response\.ok\)/);
 assert.match(collector,/inFlight=false/);
 assert.match(collector,/window\.addEventListener\("online"/);
 assert.doesNotMatch(collector,/sessionStorage\.setItem\(UNAVAILABLE_KEY/);
 assert.match(report,/ANALYTICS_HMAC_SECRET/);
 assert.match(report,/site_aggregate_report/);
 assert.match(report,/opt_in_status/);
 assert.match(report,/not_configured/);
});
