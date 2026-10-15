const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");

const chat=fs.readFileSync("assets/js/chat-v2.js","utf8");
const profile=fs.readFileSync("assets/js/profile.js","utf8");
const sql=fs.readFileSync("supabase/migrations/20261015114500_staff_direct_messaging_permission.sql","utf8");
const me="11111111-1111-4111-8111-111111111111";
const other="22222222-2222-4222-8222-222222222222";
function peopleUI({staff=false,relation=null,previous=false,allowMessages=true}={}){
  const start=chat.indexOf("function renderPeopleResults()");
  const end=chat.indexOf("async function searchPeople(",start);
  assert.ok(start>=0&&end>start);
  const fnText=chat.slice(start,end);
  const target={innerHTML:""};
  const state={user:{id:me},staffDMAllowed:staff,friendships:relation?[{
    requester_id:me,addressee_id:other,status:relation
  }]:[],directPartners:previous?[other]:[],peopleTerm:"other",
    peopleResults:[{id:other,display_name:"Other",username:"other",avatar_url:"",allow_messages:allowMessages}]};
  const escape=s=>String(s).replace(/[&<>"']/g,c=>({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  }[c]));
  const render=new Function("state","$","escapeHTML","DEFAULT_AVATAR",fnText+"\nreturn renderPeopleResults;")(
    state,()=>target,escape,"/assets/img/avatar-placeholder.svg");
  render();
  return target.innerHTML;
}
test("staff can message an unconnected member AND can request friendship separately",()=>{
  const html=peopleUI({staff:true});
  assert.match(html,/Message as staff/);
  assert.match(html,/Add friend/);
});
test("ordinary members cannot start unrestricted direct messages",()=>{
  const html=peopleUI();
  assert.doesNotMatch(html,/data-people-action="message"/);
  assert.match(html,/Add friend/);
});
test("an accepted friendship still unlocks ordinary member messaging",()=>{
  const html=peopleUI({relation:"accepted"});
  assert.match(html,/data-people-action="message"/);
  assert.doesNotMatch(html,/Add friend/);
});
test("staff cannot bypass a block or a disabled messaging preference",()=>{
  const blocked=peopleUI({staff:true,relation:"blocked"});
  const privateMember=peopleUI({staff:true,allowMessages:false});
  assert.doesNotMatch(blocked,/data-people-action="message"/);
  assert.match(blocked,/Blocked/);
  assert.doesNotMatch(privateMember,/data-people-action="message"/);
});
test("staff may message a pending friend request while friendship remains pending",()=>{
  const html=peopleUI({staff:true,relation:"pending"});
  assert.match(html,/Message as staff/);
  assert.match(html,/Request pending/);
  assert.doesNotMatch(html,/Add friend/);
});
test("regular recipient can view and reply to an existing staff-initiated DM",()=>{
  const html=peopleUI({previous:true});
  assert.match(html,/data-people-action="message"/);
  assert.match(html,/Add friend/);
  assert.match(chat,/state\.directPartners=\[\.\.\.new Set/);
  assert.match(sql,/An ordinary member can respond to a staff conversation/);
});
test("only active database staff roles can bypass friendship, and they are audited",()=>{
  assert.match(sql,/p\.role in \('moderator','admin','super'\)/);
  assert.match(sql,/p\.account_status='active'/);
  assert.match(sql,/f\.status='blocked'/);
  assert.match(sql,/allow_messages is distinct from false/);
  assert.match(sql,/staff_dm_initiations/);
  assert.match(sql,/count\(\*\) from private\.staff_dm_initiations/);
  assert.match(sql,/direct_message_permission_guard/);
  assert.match(sql,/as restrictive for insert to authenticated/);
  assert.match(sql,/new\.thread_id is distinct from/);
  assert.doesNotMatch(sql,/update public\.direct_messages|delete from public\.direct_messages/i);
});
test("the browser checks server-owned messaging permission and checks again before upload",()=>{
  assert.match(chat,/supabase\.rpc\("can_send_direct_message"/);
  assert.match(chat,/supabase\.rpc\('can_start_staff_dm'\)/);
  assert.match(chat,/if\(recipientId\)\{\s*\/\/ Recheck/);
  assert.match(profile,/staffMessageAccess=permission\.data===true/);
  assert.match(profile,/Message as staff/);
  assert.match(profile,/Add Friend/);
});
