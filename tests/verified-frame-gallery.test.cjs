const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
test("frame gallery keeps status and listeners attached after save",()=>{
 const source=read("assets/js/profile.js");
 const save=source.slice(source.indexOf('document.getElementById("saveProfileFrame")?.addEventListener'));
 assert.match(save,/state\.profile\.frame_style=result\.data\.frame_style/);
 assert.match(save,/displayPreview\(\)/);
 assert.doesNotMatch(save,/renderProfile\(\);displayPreview\(\)/);
 assert.match(save,/status\.textContent="Frame applied!/);
});
test("all collectible frame names share one canonical identity source",()=>{
 const renderer=read("assets/js/verified-identity.mjs");
 const css=read("assets/css/verified-identity.css");
 for(const name of ["signature","library","aurora","orbit","laurel","comet"]){
  assert.match(renderer,new RegExp('id:"'+name+'"'));
  assert.match(css,new RegExp('tz-frame--'+name));
 }
 assert.match(renderer,/if\(profile\?\.is_verified!==true\)return null/);
 assert.match(css,/prefers-reduced-motion:reduce/);
});

test("saving a verified frame is single-flight and persists the submitted choice",()=>{
 const source=read("assets/js/profile.js");
 const frameSection=source.slice(source.indexOf("function renderVerification()"),source.indexOf("function setupProfileTabs()"));
 assert.match(frameSection,/let frameSaving=false/);
 assert.match(frameSection,/if\(frameSaving\|\|!button/);
 assert.match(frameSection,/if\(frameSaving\)return;/);
 assert.match(frameSection,/const submittedFrame=selected;/);
 assert.match(frameSection,/update\(\{frame_style:submittedFrame\}\)/);
 assert.match(frameSection,/result\.data\?\.frame_style!==submittedFrame/);
 assert.match(frameSection,/frameSaving=false;\s*displayPreview\(\)/);
 assert.match(frameSection,/btn\.disabled=frameSaving/);
});
