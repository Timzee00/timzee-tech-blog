const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=path=>fs.readFileSync(path,"utf8");
const source=read("supabase/migrations/20261124073919_community_discussion_reels_sources.sql");
const cascade=read("supabase/migrations/20261124074001_community_reels_privacy_cascade.sql");
const nested=read("supabase/migrations/20261124074046_community_reels_nested_message_privacy.sql");

test("public Community and Discussion video sources are mirrored into Reels",()=>{
 for(const kind of ["community_thread","community_thread_media","discussion_message","discussion_topic"]){
  assert.match(source,new RegExp(kind));
 }
 assert.match(source,/community_state='active'/);
 assert.match(source,/visibility='public'/);
 assert.match(source,/status='published'/);
 assert.match(source,/moderation_status='published'/);
 assert.match(source,/ON CONFLICT \(source_key\)/);
 assert.match(source,/videos_source_key_unique/);
 assert.match(source,/community_threads_reel_sync/);
 assert.match(source,/community_thread_media_reel_sync/);
 assert.match(source,/discussion_messages_reel_sync/);
 assert.match(source,/discussion_topics_reel_sync/);
});

test("Community and Discussion video mirrors cannot be forged by clients",()=>{
 assert.match(source,/source_kind IS NULL/);
 assert.match(source,/private\.is_public_reel_source/);
 assert.match(source,/Invalid public community\/discussion video source/);
 assert.match(source,/REVOKE ALL ON FUNCTION private\.sync_community_reel_source/);
 assert.match(source,/REVOKE ALL ON FUNCTION private\.community_reel_media_sync_trigger/);
});

test("parent privacy and moderation changes cascade to child video mirrors",()=>{
 assert.match(cascade,/AFTER UPDATE OF status, community_id ON public\.community_threads/);
 assert.match(cascade,/AFTER UPDATE OF visibility, community_state ON public\.discussion_topics/);
 assert.match(nested,/m\.thread_id IN \(/);
 assert.match(nested,/private\.sync_community_reel_source/);
});
