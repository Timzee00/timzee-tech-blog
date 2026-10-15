const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const get=p=>fs.readFileSync(path.join(__dirname,"..",p),"utf8");
test("Scout manual and diagnostics require trusted Admin/Super roles",()=>{
  for(const file of ["netlify/functions/scout-news.js","netlify/functions/scout-news-status.js"])
    assert.match(get(file),/requireRole\(supabase, token, \["admin", "super"\]/);
  assert.match(get("netlify/functions/_lib/auth-role.js"),/select\("role,account_status"\)/);
  assert.match(get("netlify/functions/_lib/auth-role.js"),/account_status !== "active"/);
});
test("admins see real newsroom with working actions, not old bot settings placeholders",()=>{
  const html=get("admin/dashboard.html");
  assert.match(html,/id="adminCuratorManager"/);
  assert.doesNotMatch(html,/id="botAutoPublish"/);
  const script=get("assets/js/admin.js");
  assert.match(script,/ensureCuratorManager\(\)/);
  assert.match(script,/import\("\.\/curator-ui\.js"\)/);
  assert.doesNotMatch(script,/await setupCuratorBot\(\)/);
  const editor=get("assets/js/curator-ui.js");
  assert.match(editor,/this\.canRunScout = \["admin", "super"\]\.includes/);
  assert.match(editor,/data-type="post-approve"/);
});
test("prior screenshot fixes are integrated in main without a new branch",()=>{
  const ui=get("assets/js/curator-ui.js");
  assert.match(ui,/transform:translate\(-50%,-50%\)/);
  const mentions=get("assets/js/mentions.js");
  assert.match(mentions,/No matching community members\./);
  assert.match(mentions,/timzeeMentionsWired/);
  const video=get("video.html");
  assert.match(video,/An autoplay policy rejection applies to the whole feed/);
});
