const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const migration="supabase/migrations/20261027194532_personal_chat_clear_archive_mute.sql";

test("members can access archived direct and group chats independently",()=>{
 const page=read("chat.html"),client=read("assets/js/chat-v2.js");
 assert.match(page,/data-tab="archived"/);
 assert.match(page,/id="archivedList"/);
 assert.match(page,/data-chat-menu="archive"/);
 assert.match(page,/data-chat-menu="mute"/);
 assert.match(page,/data-chat-menu="clear"/);
 assert.match(client,/function renderArchived\(\)/);
 assert.match(client,/state\.personalViews/);
 assert.match(client,/\.eq\("user_id",state\.user\.id\)/);
 assert.match(client,/isArchived\(threadForFriend\(friendId\)\)/);
 assert.match(client,/isArchived\(g\.id\)/);
 assert.match(client,/renderArchived\(\)/);
});

test("clear is user-scoped and cannot erase shared message rows",()=>{
 const sql=read(migration);
 const js=read("assets/js/chat-v2.js");
 assert.match(sql,/chat_personal_clear_visibility/);
 assert.match(sql,/as restrictive for select to authenticated/);
 assert.match(sql,/direct_messages\.created_at <= p\.cleared_before/);
 assert.match(sql,/p\.user_id=\(select auth\.uid\(\)\)/);
 assert.match(sql,/v_actor::text=any\(v_parts\)/);
 assert.match(sql,/m\.user_id=v_actor/);
 assert.doesNotMatch(sql,/delete\s+from\s+public\.direct_messages/i);
 assert.match(js,/async function clearCurrentChat\(\)/);
 assert.match(js,/setPersonalChatView\(\{clear:true\}\)/);
 assert.match(js,/state\.messages=\[\]/);
 assert.match(js,/This cannot be undone/);
});

test("muting and archiving suppress only the recipient's notifications",()=>{
 const sql=read(migration),chat=read("assets/js/chat-v2.js");
 assert.match(sql,/prefs\.user_id=new\.recipient_id/);
 assert.match(sql,/prefs\.thread_id=new\.thread_id/);
 assert.match(sql,/prefs\.muted or prefs\.archived/);
 assert.match(sql,/case when p_archived is true then true else prefs\.muted end/);
 assert.match(chat,/async function toggleCurrentArchive\(\)/);
 assert.match(chat,/muted:next\?true:null/);
 assert.match(chat,/!isCurrentChatMuted\(\)/);
 assert.match(chat,/function isMuted\(threadId\)/);
});

test("database permissions only allow own preferences and signed-in RPC",()=>{
 const sql=read(migration);
 assert.match(sql,/alter table public\.chat_personal_views enable row level security/);
 assert.match(sql,/user_id = \(select auth\.uid\(\)\)/);
 assert.match(sql,/revoke all on function public\.set_chat_personal_view\(text,boolean,boolean,boolean\) from PUBLIC,anon/);
 assert.match(sql,/grant execute on function public\.set_chat_personal_view\(text,boolean,boolean,boolean\) to authenticated/);
 assert.match(sql,/if not v_valid then/);
 assert.doesNotMatch(sql,/DISABLE ROW LEVEL SECURITY|DISABLE TRIGGER|DROP TABLE public\.direct_messages/i);
});

test("chat client remains valid JavaScript after personal control handlers",()=>{
 const js=read("assets/js/chat-v2.js");
 const stripped=js.replace(/^import .*;\s*$/gm,"");
 assert.doesNotThrow(()=>new Function(stripped));
 assert.match(js,/clearCurrentChat\(\)\.catch/);
 assert.match(js,/toggleCurrentArchive\(\)\.catch/);
});
