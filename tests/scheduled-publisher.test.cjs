const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=file=>fs.readFileSync(path.join(root,file),"utf8");

test("scheduled publishing runs in free PostgreSQL cron with bounded concurrency",()=>{
 const sql=read("supabase/migrations/20261019022000_free_database_scheduled_publishing.sql");
 assert.match(sql,/cron\.schedule\('timzee-scheduled-articles-five-min','\*\/5 \* \* \* \*'/);
 assert.match(sql,/pg_try_advisory_xact_lock/);
 assert.match(sql,/LIMIT 100 FOR UPDATE SKIP LOCKED/);
 assert.match(sql,/publish_at<=now\(\) AT TIME ZONE 'UTC'/);
 assert.match(sql,/WHERE status='scheduled' AND publish_at IS NOT NULL/);
 assert.match(sql,/status='published'/);
 assert.match(sql,/system_job_status/);
 assert.match(sql,/REVOKE ALL ON FUNCTION private\.publish_scheduled_posts_logged/);
 assert.doesNotMatch(sql,/DELETE FROM public\.posts/);
});
test("founder operations shows overdue posts independently of future scheduled posts",()=>{
 const source=read("netlify/functions/operations-overview.js");
 const ui=read("assets/js/operations-console.mjs");
 assert.match(source,/key:"overduePosts"/);
 assert.match(source,/key:"scheduledPosts"/);
 assert.match(source,/dueBefore:true/);
 assert.match(source,/\.lte\("publish_at"/);
 assert.match(source,/"scheduled-articles":25/);
 assert.match(ui,/Overdue articles/);
 assert.match(ui,/Scheduled article publishing/);
});
