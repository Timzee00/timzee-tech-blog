const test=require("node:test");const assert=require("node:assert/strict");const fs=require("node:fs");
const ui=fs.readFileSync("assets/js/live-spaces.mjs","utf8");
const html=fs.readFileSync("spaces.html","utf8");
test("host moderation uses server-authorized LiveKit room controls",()=>{
 assert.match(ui,/spaces_remove_participant/);
 assert.match(ui,/spaces_end/);
 assert.match(ui,/providerControl\("end"\)/);
 assert.match(ui,/providerControl\("remove",userId\)/);
 assert.match(ui,/spaces-control/);
 assert.match(html,/id="spaceEnd"/);
});
test("listener controls are local and do not affect speaker publishing permission",()=>{
 assert.match(ui,/state\.mutedUsers/);
 assert.match(ui,/node\.muted=state\.mutedUsers/);
 assert.match(html,/id="spacePlayAudio"/);
 assert.match(ui,/livekit\.startAudio/);
 assert.match(ui,/livekit\.canPlaybackAudio/);
});

test("owner autojoin, shared verified frames and separate audio window are wired",()=>{
 assert.ok(ui.includes('await openRoom(room.id,{enableMic:f.timing==="now"})'));
 assert.ok(ui.includes('q.get("mini")!=="1"'));
 assert.ok(ui.includes('verification_expires_at,frame_style'));
 assert.ok(ui.includes('verifiedName(name,profile,{compact:true})'));
 assert.ok(html.includes('id="spacePopout"'));
});

test("a separate audio window broadcasts presence to a site-wide dock",()=>{
 const fs=require("node:fs"),path=require("node:path");
 const src=fs.readFileSync(path.resolve(__dirname,"../assets/js/space-mini-dock.mjs"),"utf8");
 const shell=fs.readFileSync(path.resolve(__dirname,"../assets/js/site-shell.js"),"utf8");
 assert.match(ui,/publishSpacePresence/);
 assert.match(ui,/clearSpacePresence/);
 assert.match(shell,/space-mini-dock\.mjs/);
 assert.match(src,/open\.target="timzee-space-audio"/);
});
