const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");
const video=readFileSync(join(__dirname,"../video.html"),"utf8");
const sql=readFileSync(join(__dirname,"../docs/sql/review-only-video-comment-mentions.sql"),"utf8");
test("video comments use single server-side notification path",()=>{
 assert.doesNotMatch(video,/notifyVideoComment\(/);
 assert.match(video,/The database trigger delivers owner and reply notifications/);
 assert.match(video,/id="videoCommentStatus"/);
 assert.match(video,/submit\.disabled=true/);
});
test("video mention migration limits fanout, checks opt-out and excludes duplicates",()=>{
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.notify_video_comment_event/);
 assert.match(sql,/LIMIT 8/);
 assert.match(sql,/notify_mentions IS DISTINCT FROM false/);
 assert.match(sql,/mentioned_id=NEW\.user_id/);
 assert.match(sql,/mentioned_id IS NOT DISTINCT FROM owner_id/);
 assert.match(sql,/video_mention/);
 assert.match(sql,/regexp_matches\(/);
 assert.match(sql,/RETURNS trigger/);
});
