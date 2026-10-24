const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.join(__dirname,'..');
const read=p=>fs.readFileSync(path.join(root,p),'utf8');

test('community forum is a dedicated accessible page, not the old chat-only script',()=>{
 const page=read('discussion.html');
 assert.match(page,/<main\b[^>]*id="main-content"/);
 assert.match(page,/assets\/js\/community-forum\.mjs/);
 assert.doesNotMatch(page,/assets\/js\/discussion\.js"/);
 for(const id of [
  'forumFeedView','forumThreadView','forumCommunityList','forumCategories',
  'forumThreadFeed','forumReplies','forumCommunityForm','forumThreadForm',
  'forumReplyForm','forumReportForm','forumModerationDialog'
 ])assert.match(page,new RegExp('id="'+id+'"'));
});
test('forum source syntax and referenced elements are valid',()=>{
 const page=read('discussion.html');
 const moduleCode=read('assets/js/community-forum.mjs');
 const source=moduleCode.replace(/^import[\s\S]*?from\s+"[^"]+";\s*$/gm,'')
   .replace(/^import\s+"[^"]+";\s*$/gm,'');
 assert.doesNotThrow(()=>new Function(source));
 const ids=new Set([...page.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
 const used=new Set([...moduleCode.matchAll(/\$\("([^"]+)"\)/g)].map(match=>match[1]));
 const dynamic=new Set(['forumPostingPolicy']);
 assert.deepEqual([...used].filter(id=>!ids.has(id)&&!dynamic.has(id)),[]);
});
test('existing discussions and share links migrate without deleting conversations',()=>{
 const migration=read('supabase/migrations/20261017012000_forum_legacy_topic_rehome.sql');
 const previous=read('supabase/migrations/20261017010000_community_forums.sql');
 const backward=read('supabase/migrations/20261017013000_legacy_topic_write_compatibility.sql');
 const client=read('assets/js/community-forum.mjs');
 assert.match(previous,/ALTER TABLE public\.discussion_messages ADD COLUMN IF NOT EXISTS thread_id/);
 assert.match(previous,/UPDATE public\.discussion_messages m SET thread_id/);
 assert.match(migration,/community_legacy_redirects/);
 assert.match(migration,/community_state='archived'/);
 assert.doesNotMatch(migration,/DELETE FROM public\.discussion_messages/i);
 assert.match(backward,/old_topic_id=new\.topic_id/);
 assert.match(client,/params\.get\("topic"\)/);
});
test('scalable read paths use indexes, page limits and search, not full history scans',()=>{
 const schema=read('supabase/migrations/20261017010000_community_forums.sql');
 const search=read('supabase/migrations/20261017011000_community_search_rate_guards.sql');
 const client=read('assets/js/community-forum.mjs');
 assert.match(schema,/community_threads_active_idx/);
 assert.match(schema,/community_threads_global_new_idx/);
 assert.match(schema,/community_messages_thread_idx/);
 assert.match(search,/community_thread_search_gin/);
 assert.match(client,/const PAGE_SIZE=20/);
 assert.match(client,/\.limit\(PAGE_SIZE\+1\)/);
 assert.match(client,/\.limit\(31\)/);
 assert.match(client,/query\.or\(col\+"\.lt\."/);
 assert.match(client,/\.textSearch\("search_vector"/);
});
test('thread moderation and report actions require server authorization',()=>{
 const sql=read('supabase/migrations/20261017016000_community_reports_moderation.sql');
 const moderation=read('supabase/migrations/20261017015000_forum_moderation_privacy_spam.sql');
 const schema=read('supabase/migrations/20261017010000_community_forums.sql');
 assert.match(schema,/ENABLE ROW LEVEL SECURITY/);
 assert.match(schema,/community_manage_thread/);
 assert.match(sql,/CREATE POLICY community_reports_insert/);
 assert.match(sql,/CREATE POLICY community_reports_read/);
 assert.match(sql,/community_review_report/);
 assert.match(sql,/community_moderate_member/);
 assert.match(moderation,/DROP POLICY IF EXISTS "Discussion messages are public"/);
 assert.match(moderation,/community_reply_rate_guard/);
 assert.match(moderation,/forum_reply_media_guard/);
});
test('only owner-scoped forum attachments can be uploaded and legacy media stays available',()=>{
 const sql=read('supabase/migrations/20261017014000_forum_media_and_uploads.sql');
 const client=read('assets/js/community-forum.mjs');
 assert.match(sql,/auth_upload_own_community_media/);
 assert.match(sql,/storage\.foldername\(name\)\)\[2\]=\(SELECT auth\.uid\(\)\)::text/);
 assert.match(sql,/UPDATE public\.community_threads t SET media_url=old\.media_url/);
 // Extra arguments identify member-only media for authenticated signing.
 assert.match(client,/function mediaHtml\(url,type,kind="thread",itemId="",position=0\)/);
 assert.match(client,/String\(url\)\.startsWith\("forum-private-media\/"\)/);
 assert.match(client,/if\(!isSafeUrl\(url\)\)return "";/);
 assert.match(client,/loading='lazy'/);
 assert.match(client,/preload='none'/);
 assert.match(client,/file\.size>12\*1024\*1024/);
});
