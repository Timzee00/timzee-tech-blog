const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=p=>fs.readFileSync(p,"utf8");
const reels=src("video.html"),fyp=src("assets/js/fyp.js"),
  fypCss=src("assets/css/fyp.css"),uploader=src("videos.html"),
  mentions=src("assets/js/mentions.js"),tags=src("assets/js/social-rich-text.mjs");
test("Reels single and double tap hit the entire visual reel rather than center-only tap zone",()=>{
 assert.match(reels,/querySelectorAll\("\.reel-item:not\(\[data-reel-tap-wired\]\)"\)/);
 assert.match(reels,/now-previous\.at<360/);
 assert.match(reels,/triggerLikeBurst\(idx,e\)/);
 assert.match(reels,/if\(vid\.paused\)/);
 assert.match(reels,/if\(e\.target\.closest\("button,a,\.reel-progress/);
});
test("Reels show uncropped frame and accessible seek/rewind actions",()=>{
 assert.match(reels,/\.reel-video\s*\{[\s\S]*?object-fit:\s*contain/);
 assert.match(reels,/bottom: max\(8px, env\(safe-area-inset-bottom\)\)/);
 assert.match(reels,/data-action="rewind"/);
 assert.match(reels,/video\.currentTime=Math\.max\(0/);
 assert.match(reels,/reel-caption-more/);
});
test("Reels and FYP derive true like and comment counts from public RPC",()=>{
 assert.match(reels,/video_social_counts/);
 assert.match(reels,/video_comment_like_counts/);
 assert.match(reels,/Number\(video\.comment_count\|\|0\)/);
 assert.match(fyp,/video_social_counts/);
 assert.match(fyp,/fyp-comment-count/);
});
test("RLS-protected comment likes work in Reel drawer and FYP",()=>{
 assert.match(reels,/video_comment_likes/);
 assert.match(reels,/data-comment-like=/);
 assert.match(reels,/aria-pressed/);
 assert.match(fyp,/dataset\.fypCommentLike/);
 assert.match(fyp,/video_comment_likes/);
});
test("FYP discussion topics have like and inline reply actions",()=>{
 assert.match(fyp,/discussion_topic_likes/);
 assert.match(fyp,/discussion_messages/);
 assert.match(fyp,/\["post","video","discussion"\]/);
 assert.match(fyp,/Reply posted/);
});
test("FYP portrait player displays full video with gesture and fullscreen support",()=>{
 assert.match(fypCss,/object-fit:contain/);
 assert.match(fypCss,/height:\s*clamp\(360px,79dvh,820px\)/);
 assert.match(fyp,/data-fyp-video-gestures/);
 assert.match(fyp,/requestFullscreen/);
 assert.match(fyp,/bindFypVideoGestures\(target\)/);
});
test("mention picker prioritizes friends and works in every requested composer",()=>{
 assert.match(mentions,/\.from\("friendships"\)/);
 assert.match(mentions,/\.eq\("status","accepted"\)/);
 assert.match(mentions,/is_friend:friends\.includes/);
 assert.match(reels,/setupMentionInput\(drawerInput\)/);
 assert.match(fyp,/setupMentionInput\(field\)/);
 assert.match(src("assets/js/discussion.js"),/setupMentionInput\(document\.getElementById\("messageBody"\)\)/);
 assert.match(uploader,/setupMentionInput\(document\.getElementById\("videoDescription"\)\)/);
});
test("hashtags are escaped and have a real public route",()=>{
 assert.match(tags,/escapeSocial/);
 assert.match(tags,/hashtags\.html\?tag=/);
 assert.match(src("hashtags.html"),/discussion_messages/);
 assert.match(src("hashtags.html"),/video_comments/);
 assert.match(src("assets/js/utils.js"),/hashtags\.html\?tag=/);
});
test("editing cannot silently fall back to an unedited video",()=>{
 assert.match(uploader,/state\.editorDirty=true/);
 assert.match(uploader,/state\.editRenderInProgress=true/);
 assert.match(uploader,/state\.trimmedFile=null/);
 assert.match(uploader,/if\(state\.editRenderInProgress\|\|state\.editorDirty\)/);
 assert.match(uploader,/detectVideoDuration\(editedFile\)/);
 assert.match(uploader,/fileToUpload = state\.trimmedFile \|\| videoFile\.files\[0\]/);
 assert.match(uploader,/id="coverMoment"/);
 assert.match(uploader,/id="captionPreview"/);
});
test("comment/discussion migration grants limited per-user reactions",()=>{
 const migration=src("supabase/migrations/20261015100000_video_comment_topic_likes_counts.sql");
 assert.match(migration,/user_id=\(select auth\.uid\(\)\)/);
 assert.match(migration,/unique\(comment_id,user_id\)/);
 assert.match(migration,/unique\(topic_id,user_id\)/);
 assert.match(migration,/video_social_counts/);
 assert.match(src("supabase/migrations/20261015103000_video_comment_like_counts.sql"),/video_comment_like_counts/);
});

test("reel owner can edit caption with an authoritative persisted update",()=>{
 const html=require("node:fs").readFileSync(require("node:path").resolve(__dirname,"../video.html"),"utf8");
 for(const field of ["reelEditor","reelEditTitle","reelEditDescription","reelEditorSave"])
   assert.ok(html.includes('id="'+field+'"'));
 assert.ok(html.includes('data-edit-reel'));
 assert.ok(html.includes('.eq("id",reel.id).eq("user_id",state.user.id).select("id,title,description").maybeSingle()'));
 assert.ok(html.includes('if(!result.data||result.data.id!==reel.id'));
});

test("video creator settings need an authoritative database confirmation",()=>{
 const fs=require("node:fs");
 const html=fs.readFileSync("video.html","utf8");
 assert.ok(html.includes(".select('id,allow_comments,allow_download').maybeSingle()"));
 assert.ok(html.includes("The database did not confirm this change"));
});
