const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const get=p=>fs.readFileSync(p,"utf8");
test("Spaces and team workspaces connect publishing, communities and voice",()=>{
 const html=get("spaces.html"),ui=get("assets/js/live-spaces.mjs"),team=get("assets/js/team-workspaces.mjs");
 assert.match(html,/id="spacesCreateForm"/);
 assert.match(html,/id="spacePlayAudio"/);
 assert.match(html,/id="spaceHostPanel"/);
 assert.match(ui,/spaces_join/);
 assert.match(ui,/spaces_request_speaker/);
 assert.match(ui,/spaces_review_speaker/);
 assert.match(ui,/spaces_remove_participant/);
 assert.match(ui,/LivekitClient/);
 assert.match(ui,/publishData/);
 assert.match(team,/team_studio_projects/);
 assert.match(team,/team_pending_invites/);
 assert.match(team,/spaces\.html\?workspace=/);
 assert.match(get("creator-studio.html"),/team-workspaces\.html/);
 assert.match(get("discussion.html"),/href="spaces\.html"/);
 assert.match(get("post.html"),/id="discussArticleLive"/);
});
test("provider authentication and management are exclusively server-side",()=>{
 const client=get("assets/js/live-spaces.mjs"),auth=get("netlify/functions/spaces-token.js"),
 control=get("netlify/functions/spaces-control.js");
 assert.doesNotMatch(get("spaces.html")+client,/LIVEKIT_API_SECRET|SUPABASE_SERVICE_ROLE_KEY/);
 assert.match(auth,/getUserWithTrustedRole/);
 assert.match(auth,/participant\.state!=="present"/);
 assert.match(control,/owner_id!==user\.user\.id/);
 assert.match(control,/roomResult\.data\.status!=="ended"/);
 assert.match(control,/result\.data\?\.state!=="removed"/);
 assert.match(get("_headers"),/wss:\/\/\*\.livekit\.cloud/);
});
test("migration history contains explicit RLS grants and owner approvals",()=>{
 const path="supabase/migrations/";
 const sql=fs.readdirSync(path).filter(n=>/2026102314.*(spaces|team)/.test(n))
 .map(n=>get(path+n)).join("\n");
 assert.match(sql,/ENABLE ROW LEVEL SECURITY/);
 assert.match(sql,/spaces_creation_guard/);
 assert.match(sql,/team_project_approval_guard/);
 assert.match(sql,/private\.team_role/);
 assert.match(sql,/REVOKE ALL ON TABLE/);
 assert.match(sql,/team_pending_invites/);
});
