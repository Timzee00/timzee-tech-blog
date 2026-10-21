const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
test("weekly completion counts are private and use indexed completed articles",()=>{
 const sql=read("supabase/migrations/20261020100000_private_weekly_reading_goal.sql");
 assert.match(sql,/WHERE completed_at IS NOT NULL/);
 assert.match(sql,/r\.user_id=\(SELECT auth\.uid\(\)\)/);
 assert.match(sql,/r\.completed_at>=date_trunc\('week'/);
 assert.match(sql,/SECURITY INVOKER/);
 assert.match(sql,/GRANT EXECUTE ON FUNCTION public\.reader_weekly_completion_count\(\) TO authenticated/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.reader_weekly_completion_count\(\)/);
});
test("goal is opt-in, validated and not a feed ranking signal",()=>{
 const prefs=read("assets/js/user-preferences.js");
 const home=read("assets/js/reader-home.mjs");
 const ranker=read("assets/js/reader-interest-ranker.mjs");
 assert.match(prefs,/weeklyReadingGoal: 0/);
 assert.match(prefs,/\[0,2,4,7\]\.includes\(value\)/);
 assert.match(home,/saveUserPreferences\(user\.id,\{feed:\{weeklyReadingGoal:target\}\}\)/);
 assert.match(home,/reader_weekly_completion_count/);
 assert.match(home,/if\(Number\(select\.value\)>0\)void refresh\(\)/);
 assert.doesNotMatch(ranker,/weeklyReadingGoal|streak/);
});
test("goal controls fit mobile and use accessible progress/status semantics",()=>{
 const css=read("assets/css/reader-journey.css");
 const home=read("assets/js/reader-home.mjs");
 assert.match(css,/\.tz-reader-weekly-goal\{display:grid/);
 assert.match(css,/@media\(max-width:360px\)/);
 assert.match(home,/aria-label","Weekly reading goal"/);
 assert.match(home,/aria-live","polite"/);
 assert.match(home,/progress\.max=goal/);
});

test("weekly goal failures restore the latest confirmed value, not the initial setting",()=>{
 const home=read("assets/js/reader-home.mjs");
 assert.match(home,/let confirmedGoal=allowed\.includes\(saved\)\?saved:0/);
 assert.match(home,/confirmedGoal=target;/);
 assert.match(home,/select\.value=String\(confirmedGoal\)/);
 assert.doesNotMatch(home,/catch\(error\)\{\s*select\.value=String\(saved\)/);
});
