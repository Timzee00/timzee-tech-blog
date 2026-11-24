const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=path=>fs.readFileSync(path,"utf8");
const migration=read("supabase/migrations/20261124072758_unified_personalized_reels.sql");
const video=read("video.html");
const discovery=read("assets/js/video-discovery.mjs");
const menu=read("assets/js/blipmood-unified-menu.mjs");

test("public post-gallery videos are mirrored into the existing Reel catalog",()=>{
 assert.match(migration,/source_post_id uuid REFERENCES public\.posts\(id\) ON DELETE CASCADE/i);
 assert.match(migration,/source_media_id uuid REFERENCES public\.post_media\(id\) ON DELETE CASCADE/i);
 assert.match(migration,/pm\.media_type = 'video'/);
 assert.match(migration,/p\.status = 'published'/);
 assert.match(migration,/p\.publish_at IS NULL OR p\.publish_at <=/);
 assert.match(migration,/post_media_video_discovery_sync/);
 assert.match(migration,/posts_video_discovery_sync/);
 assert.match(migration,/ON CONFLICT \(source_media_id\)/);
 assert.match(migration,/Blipmood client cannot insert post video mirrors/);
 assert.match(migration,/Blipmood client cannot update post video mirrors/);
 assert.match(migration,/Blipmood client cannot delete post video mirrors/);
 assert.doesNotMatch(migration,/direct_messages/i);
});

test("viewer watch history and topic affinity are private and bounded",()=>{
 assert.match(migration,/CREATE TABLE IF NOT EXISTS public\.video_watch_signals/);
 assert.match(migration,/CREATE TABLE IF NOT EXISTS public\.video_user_topic_affinity/);
 assert.match(migration,/ENABLE ROW LEVEL SECURITY/);
 assert.match(migration,/Members read own video watch signals/);
 assert.match(migration,/Members read own video topic affinity/);
 assert.match(migration,/p_watch_seconds integer/);
 assert.match(migration,/least\(90, greatest\(0, coalesce\(p_watch_seconds/);
 assert.match(migration,/watch_seconds = least\(3600/);
 assert.match(migration,/LIMIT 40/);
 assert.match(migration,/prune_video_watch_signals/);
 assert.match(migration,/watched_on < \(\(now\(\) AT TIME ZONE 'UTC'\)::date - 90\)/);
 assert.match(migration,/GRANT EXECUTE ON FUNCTION public\.record_video_watch_signal\(uuid, integer, boolean\) TO authenticated/);
 assert.match(migration,/REVOKE ALL ON FUNCTION public\.record_video_watch_signal\(uuid, integer, boolean\) FROM PUBLIC, anon, authenticated/);
});

test("Reels ranking uses individual interests, watch fatigue and creator diversity",()=>{
 assert.match(migration,/a\.user_id = \(SELECT id FROM viewer\)/);
 assert.match(migration,/public\.video_user_topic_affinity a/);
 assert.match(migration,/public\.video_watch_signals w/);
 assert.match(migration,/w\.watched_on >=/);
 assert.match(migration,/row_number\(\) OVER \(/);
 assert.match(migration,/PARTITION BY c\.user_id/);
 assert.match(migration,/creator_position/);
 assert.match(migration,/public\.blipmood_feature_allowed\('fyp_recommendations'\)/);
 assert.match(migration,/user_content_feedback/);
});

test("Reels client sends real playback signals in bounded batches",()=>{
 assert.match(discovery,/export async function recordVideoWatchSignal/);
 assert.match(discovery,/record_video_watch_signal/);
 assert.match(video,/recordVideoWatchSignal\(supabase/);
 assert.match(video,/video\.addEventListener\("timeupdate"/);
 assert.match(video,/watchedSeconds>=10/);
 assert.match(video,/video\.addEventListener\("ended"/);
 assert.match(video,/video\.addEventListener\("pause"/);
 assert.match(video,/state\.user\?\.id/);
 assert.match(video,/source_post_id/);
 assert.match(video,/View original post/);
});

test("watch-signal client clamps each playback batch before calling the RPC",async()=>{
 const {recordVideoWatchSignal}=await import("../assets/js/video-discovery.mjs");
 const calls=[];
 const supabase={rpc:async(name,args)=>{calls.push({name,args});return {data:true,error:null};}};
 assert.equal(await recordVideoWatchSignal(supabase,{videoId:"video-a",watchSeconds:240,completed:true}),true);
 assert.deepEqual(calls,[{name:"record_video_watch_signal",args:{
  p_video_id:"video-a",p_watch_seconds:90,p_completed:true
 }}]);
 assert.equal(await recordVideoWatchSignal(supabase,{videoId:"video-a",watchSeconds:2}),false);
 assert.equal(calls.length,1,"sub-threshold playback must not create a request");
});

test("Reels does not load or inject the general navigation menu",()=>{
 assert.doesNotMatch(video,/blipmood-unified-menu\.mjs/);
 assert.doesNotMatch(menu,/installReelMenu|bmReelMenuToggle|bm-reel-menu-panel/);
});
