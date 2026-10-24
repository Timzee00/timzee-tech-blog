const test=require("node:test");
const assert=require("node:assert/strict");
const vm=require("node:vm");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");
const clock=read("assets/js/launch-clock.mjs").replace(/^export\s+/gm,"");
const context={};
vm.runInNewContext(clock+"\nthis.api={remainingLaunchTime,featureStatusLabel,launchFeaturePath};",context);
const {remainingLaunchTime,featureStatusLabel,launchFeaturePath}=context.api;
test("countdown renders exact time units and never auto-publishes from the browser",()=>{
 const target=Date.UTC(2027,0,1,0,0,0);
 const diff=(86400+2*3600+3*60+4)*1000;
 const result=remainingLaunchTime(new Date(target).toISOString(),target-diff);
 assert.equal(result.label,"1d 02h 03m 04s");
 assert.equal(result.running,true);
 assert.equal(remainingLaunchTime(new Date(target).toISOString(),target).running,false);
 assert.match(remainingLaunchTime(new Date(target).toISOString(),target+1).label,/awaiting confirmation/);
 assert.equal(remainingLaunchTime(null).label,"Launch date to be announced");
 assert.equal(featureStatusLabel("live"),"Live now");
});
test("launch destinations are local and cannot contain external URLs or path traversal",()=>{
 assert.equal(launchFeaturePath({target_path:"/spaces.html"}),"/spaces.html");
 assert.equal(launchFeaturePath({target_path:"/index.html#suggestedPeopleSection"}),"/index.html#suggestedPeopleSection");
 for(const value of ["https://attacker.example","//attacker.example","/../../secret.html","javascript:alert(1)"]){
   assert.equal(launchFeaturePath({target_path:value}),null,value);
 }
});
test("launch migration uses least-privilege RLS and private idempotent batch notification delivery",()=>{
 const sql=read("supabase/migrations/20261024173000_feature_launch_manager.sql");
 for(const fragment of [
   "ALTER TABLE public.feature_launches ENABLE ROW LEVEL SECURITY",
   "ALTER TABLE public.feature_launch_subscriptions ENABLE ROW LEVEL SECURITY",
   "feature_launch_staff_update",
   "feature_launch_subscriptions_self_insert",
   "auth.uid()",
   "public.has_role_secure('admin')",
   "public.has_role_secure('super')",
   "SKIP LOCKED",
   "s.notified_at IS NULL",
   "private.process_feature_launches",
   "cron.schedule",
   "'*/5 * * * *'"
 ])assert.ok(sql.includes(fragment),"Missing launch security/automation guarantee: "+fragment);
 assert.match(sql,/REVOKE ALL ON FUNCTION private\.process_feature_launches\(integer\) FROM PUBLIC, anon, authenticated/);
 assert.match(sql,/WHERE l\.id = launch_id AND l\.is_public = true AND l\.status <> 'live'/);
 assert.doesNotMatch(sql,/GRANT (?:ALL|INSERT|UPDATE|DELETE) ON public\.feature_launches TO anon/i);
});
test("admin panel exposes a launch tab, safe edit controls and section-target presets",()=>{
 const html=read("admin/dashboard.html"),js=read("assets/js/launch-admin.mjs"),app=read("assets/js/admin.js");
 assert.match(html,/data-tab="launches"/);
 assert.match(html,/id="featureForm"/);
 assert.match(html,/id="featureTargetChoices"/);
 assert.match(html,/id="featureAutoLaunch"/);
 assert.match(html,/id="featureManagerStatus"/);
 assert.match(app,/ensureLaunchManager/);
 assert.match(js,/\.select\("id"\)\.single\(\)/);
 assert.match(js,/autoLaunch&&\!launchAt/);
 assert.match(js,/target_path:targetPath\|\|null/);
});
test("public launch board is opt-in, displays accurate statuses, and never invents a launched state",()=>{
 const js=read("assets/js/launches.mjs"),html=read("launches.html"),context=read("assets/js/launch-context.mjs");
 assert.match(html,/id="launchesGrid"/);
 assert.match(js,/feature\.status==="live"/);
 assert.match(js,/state\.subscribed\.has\(feature\.id\)/);
 assert.match(js,/feature_launch_subscriptions/);
 assert.match(js,/user_id:state\.user\.id/);
 assert.match(js,/aria-pressed/);
 assert.match(context,/\.neq\("status","live"\)/);
 assert.match(context,/section\.before\(banner\)/);
 assert.match(read("assets/js/site-shell.js"),/launch-context\.mjs/);
 assert.match(read("assets/css/styles.css"),/feature-launches\.css/);
 assert.match(read("assets/css/admin.css"),/feature-launches\.css/);
});