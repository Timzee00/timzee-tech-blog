const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const read=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");

test("aggregate storage stores totals only and denies anonymous database access",()=>{
  const sql=read("supabase/migrations/20261030030000_cookieless_aggregate_traffic.sql");
  assert.match(sql,/create table if not exists public[.]site_aggregate_events/i);
  assert.match(sql,/shard smallint/);
  assert.match(sql,/total bigint/);
  assert.match(sql,/enable row level security/i);
  assert.match(sql,/revoke all on public[.]site_aggregate_events from public,anon,authenticated/i);
  assert.match(sql,/grant execute on function public[.]record_site_aggregate_event.+to service_role/i);
  assert.match(sql,/on conflict.+do update set total=/is);
  assert.doesNotMatch(sql,/visitor_hash|ip_address|user_agent|user_id|referrer/i);
});

test("anonymous collector accepts only predefined page events",()=>{
  const api=read("netlify/functions/site-aggregate-event.js");
  assert.doesNotThrow(()=>new vm.Script(api));
  assert.match(api,/allowedEvents=new Set/);
  assert.match(api,/validPage=/);
  assert.match(api,/process.env.CONTEXT!=="production"/);
  assert.match(api,/createClient/);
  assert.match(api,/crypto[.]randomInt[ ]*[(]32[)]/);
  assert.doesNotMatch(api,/ANALYTICS_HMAC_SECRET|JSON[.]stringify[(]h[)]/);
});

test("public visitor script counts a page open without an opt-in ID",()=>{
  const client=read("assets/js/visitor-analytics.js");
  assert.match(client,/collectPublicAggregateTraffic/);
  assert.match(client,/record[(]"view"[)]/);
  assert.match(client,/record[(]"engaged"[)]/);
  assert.match(client,/record[(]"signup_click"[)]/);
  assert.match(client,/seconds>=15 && interacted/);
  assert.match(client,/credentials:"omit"/);
  assert.match(client,/hasOptionalCookieConsent[(]"measurement"[)]/);
  assert.doesNotMatch(client,/navigator[.]sendBeacon[(][^)]*userId/);
});

test("Super Admin reports page opens and interest without implying unique people",()=>{
  const api=read("netlify/functions/site-traffic-report.js");
  const ui=read("super/professional-panel.html");
  assert.match(api,/requireRole\(db,token,\["super"\]/);
  assert.match(api,/site_aggregate_report/);
  assert.match(api,/opt_in_status/);
  assert.match(ui,/Page opens [(]all cookie choices[)]/);
  assert.match(ui,/Engaged page opens/);
  assert.match(ui,/Join button clicks/);
  assert.match(ui,/Most visited sections/);
  const start=ui.indexOf("const loadTraffic = async () => {");
  const end=ui.indexOf('document.getElementById("trafficRange").addEventListener',start);
  assert.ok(start>0 && end>start);
  assert.doesNotThrow(()=>new vm.Script(ui.slice(start,end)));
});

test("privacy policy distinguishes aggregate counts from optional cookies",()=>{
  assert.match(read("privacy.html"),/Anonymous site traffic totals/);
  assert.match(read("cookies.html"),/daily counters rather than identifiable browsing records/);
});
