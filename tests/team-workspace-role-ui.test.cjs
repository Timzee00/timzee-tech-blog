const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const html=fs.readFileSync("team-workspaces.html","utf8");
const ui=fs.readFileSync("assets/js/team-workspaces.mjs","utf8");
test("members can view team content without inheriting editing permissions",()=>{
 assert.match(html,/id="teamProjectPreview"/);
 assert.match(html,/id="teamPreviewBody"/);
 assert.match(ui,/\$\("teamProjectForm"\)\.hidden=!editor/);
 assert.match(ui,/const editor=\["owner","admin","editor"\]\.includes\(state\.role\)/);
 assert.match(ui,/const buttons=\[\["View"/);
 assert.match(ui,/if\(editor\)\{/);
 assert.match(ui,/teamPreviewBody"\)\.textContent=project\.body/);
});
test("approval is displayed only for owners and admins, with editor re-review",()=>{
 assert.match(ui,/querySelector\('option\[value="approved"\]'\)\.disabled=!manager/);
 assert.match(ui,/!manager&&project\.status==="approved"\?"review":project\.status/);
 assert.match(ui,/if\(!state\.active\|\|!\["owner","admin","editor"\]\.includes\(state\.role\)\)return/);
 assert.match(ui,/teamProjectForm"\)\.hidden=!editor/);
});
