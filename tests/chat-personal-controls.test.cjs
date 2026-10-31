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

test("Blipmood chat keeps all five tabs legible and the approved wordmark",()=>{
 const html=read("chat.html"),css=read("assets/css/blipmood-chat-redesign.css");
 assert.match(html,/class="chat-inbox-wordmark" data-bm-logo="wordmark"/);
 assert.doesNotMatch(html,/class="chat-inbox-mark"/);
 assert.match(html,/class="chat-status-shortcut"/);
 assert.match(html,/href="stories.html" aria-label="Open Status"/);
 for(const name of ["all","dms","groups","archived","requests"])
   assert.match(html,new RegExp('data-tab="'+name+'"'));
 assert.match(css,/\.chat-sidebar \.chat-tabs\{[\s\S]*?flex:0 0 auto/);
 assert.match(css,/grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
 assert.match(css,/\.chat-tab:nth-of-type\(4\)/);
 assert.match(css,/\.chat-tab:nth-of-type\(5\)/);
 assert.match(css,/\.chat-tab-panel:not\(\[hidden\]\)/);
 assert.match(css,/\.chat-tab-badge\[hidden\]\{display:none!important\}/);
});

test("people search and friend requests are visible, wired and accessible",()=>{
 const html=read("chat.html"),js=read("assets/js/chat-v2.js");
 assert.match(html,/id="chatFindPeopleButton"/);
 assert.match(html,/Find people &amp; send requests/);
 assert.match(html,/id="peopleSearchPanel" role="dialog"/);
 assert.match(html,/id="peopleSearch" placeholder="Name or username"/);
 assert.match(js,/bindSearch\(\$\("peopleSearch"\), searchPeople\)/);
 assert.match(js,/\$\("chatFindPeopleButton"\)\?\.addEventListener\("click",togglePeopleSearch\)/);
 assert.match(js,/for\(const id of \["peopleSearchToggle","chatFindPeopleButton"\]\)/);
 assert.match(js,/\.from\('friendships'\)\.insert\(/);
 assert.match(js,/\.or\(`display_name\.ilike\.\$\{pattern\},username\.ilike\.\$\{pattern\}`\)/);
});

test("group badge is not membership count and known profiles render public names",()=>{
 const js=read("assets/js/chat-v2.js"),html=read("chat.html");
 assert.match(js,/function chatProfileLabel\(profile\)/);
 assert.match(js,/profile\?\.username\|\|profile\?\.display_name/);
 assert.match(js,/return name\.slice\(0,80\)\|\|'Unknown user'/);
 assert.match(js,/badge\.textContent='';badge\.hidden=true/);
 assert.doesNotMatch(js,/badge\.textContent=String\(state\.groups\.filter/);
 assert.doesNotMatch(js,/\|\|['"]Member['"]/);
 assert.match(js,/verifiedName\(chatProfileLabel\(p\),p,\{compact:true\}\)/);
 assert.match(html,/id="groupsBadge" hidden/);
});
