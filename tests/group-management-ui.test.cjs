const test=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {resolve}=require('node:path');
const read=path=>readFileSync(resolve(__dirname,'..',path),'utf8');

test('group details expose leave, add person, invite controls and owner-configurable permissions',()=>{
 const page=read('chat.html');
 for(const id of ['groupLeaveBtn','groupAddMembersBtn','groupShareInviteBtn',
   'groupAllowMembersAdd','groupAllowModeratorsAdd','groupAllowAdminAdd',
   'groupAllowInviteLinks','groupAllowAdminInvites','groupAllowAdminSettings','groupRestrictionNotice','groupUnbanBtn']){
   assert.match(page,new RegExp('id="'+id+'"'));
 }
});
test('chat membership actions invoke enforced database functions rather than raw privileged updates',()=>{
 const js=read('assets/js/chat-v2.js');
 for(const rpc of ['leave_chat_group','add_group_chat_member','generate_chat_group_invite',
   'join_chat_group_by_invite','suspend_chat_group_member',
   'lift_chat_group_suspension','chat_group_restriction_status','manage_chat_group_member','unban_chat_group_member','update_chat_group_settings','update_chat_group_details']){
   assert.ok(js.includes("'"+rpc+"'"),'Missing RPC '+rpc);
 }
 assert.match(js,/p_minutes:minutes,p_hidden:hidden/);
 assert.match(js,/role!=='owner'/);
 assert.match(js,/updateGroupControlVisibility\(\)/);
 assert.match(js,/if\(row\)\{/);
 assert.match(js,/state\.canCompose=false;updateComposer\(\)/);
 assert.match(js,/if\(restriction==='hidden'\)/);
 assert.match(js,/previousGroupRestrictionMode/);
 assert.match(js,/groupRestrictionTimer/);
 assert.match(js,/public_profiles/);
 assert.match(js,/profile\.html\?id=\$\{encodeURIComponent\(m\.sender_id\)\}/);
});
test('chat invite uses a signed-in token redemption and controlled URL, not a direct membership insert',()=>{
 const js=read('assets/js/chat-v2.js');
 assert.match(js,/joinFromInvitation\(params\.get\('join'\)\)/);
 assert.match(js,/\^\[0-9a-f\]\{64\}\$/);
 assert.match(js,/link\.searchParams\.set\('join',String\(data\)\)/);
 assert.match(js,/login\.html\?next=/);
});
test('outside-drawer search opens an accessible header form that routes to homepage search',()=>{
 const nav=read('assets/js/nav.js'),css=read('assets/css/navbar.css'),app=read('assets/js/app.js');
 assert.match(nav,/site-global-search-button/);
 assert.match(nav,/form\.action="\/index\.html"/);
 assert.match(nav,/name="search"/);
 assert.match(css,/\.site-menu \.search-box\{display:none!important\}/);
 assert.match(app,/new URLSearchParams\(location\.search\)\.get\("search"\)/);
});

test('group creator explicitly controls delegated admin editing privileges',()=>{
  const sql=read('supabase/migrations/20261027141929_group_admin_delegated_settings_and_details.sql');
  const chat=read('assets/js/chat-v2.js');
  assert.match(sql,/allow_admin_manage_settings/);
  assert.match(sql,/v_actor<>v_owner AND v_key='allow_admin_manage_settings'/);
  assert.match(sql,/v_role IS DISTINCT FROM 'admin'/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.update_chat_group_settings\(uuid,jsonb\) FROM PUBLIC,anon/);
  assert.match(sql,/REVOKE ALL ON FUNCTION public\.update_chat_group_details\(uuid,text,text\) FROM PUBLIC,anon/);
  assert.doesNotMatch(sql,/DISABLE ROW LEVEL SECURITY|DISABLE TRIGGER|DROP POLICY/i);
  assert.match(chat,/if\(owner\)settings\.allow_admin_manage_settings=/);
  assert.match(chat,/groupAllowAdminSettingsLabel/);
});
test('hidden restrictions block loading messages; read-only mode disables sending',()=>{
  const code=read('assets/js/chat-v2.js');
  const hidden=code.indexOf("if(restriction==='hidden')");
  const messageLoad=code.indexOf('await loadMessages(threadId, selection);');
  assert.ok(hidden>=0&&hidden<messageLoad);
  assert.match(code,/state\.canCompose=false;updateComposer\(\)/);
  assert.match(code,/previousGroupRestrictionMode/);
  assert.match(code,/groupRestrictionTimer/);
  assert.match(code,/joinFromInvitation/);
});
