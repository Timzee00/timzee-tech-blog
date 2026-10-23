const test=require("node:test");const assert=require("node:assert/strict");const fs=require("node:fs");
const ui=fs.readFileSync("assets/js/team-workspaces.mjs","utf8");
const html=fs.readFileSync("team-workspaces.html","utf8");
const sql=fs.readFileSync("supabase/migrations/20261023143802_team_workspace_approval_and_invite_safety.sql","utf8");
test("role-gated settings and member invitations are implemented",()=>{
 assert.match(html,/id="teamSettingsForm"/);
 assert.match(ui,/team_pending_invites/);
 assert.match(ui,/state\.role!=="owner"/);
 assert.match(ui,/team_invite_member/);
 assert.match(ui,/team_accept_invite/);
 assert.match(ui,/team_studio_projects/);
});
test("owner or admin approves final content and invitation names are private",()=>{
 assert.match(sql,/private\.team_project_approval_guard/);
 assert.match(sql,/role NOT IN \('owner','admin'\)/);
 assert.match(sql,/NEW\.approved_by/);
 assert.match(sql,/NEW\.approved_at/);
 assert.match(sql,/team_creation_guard/);
 assert.match(sql,/team_pending_invites/);
 assert.match(sql,/m\.user_id=\(SELECT auth\.uid\(\)\)/);
});
