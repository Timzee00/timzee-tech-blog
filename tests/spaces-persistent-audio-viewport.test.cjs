const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const read=path=>fs.readFileSync(path,"utf8");
const source=read("assets/js/live-spaces.mjs");
const page=read("spaces.html");
const style=read("assets/css/live-spaces.css");
const mini=read("assets/js/space-mini-dock.mjs");
const nav=read("assets/css/navbar.css");

test("three distinct, labeled, live-updating groups have unique element IDs",()=>{
 for(const [id,heading] of [
  ["spacesActiveSpeakers","Speaking now"],
  ["spacesSpeakers","Other speakers"],
  ["spacesListeners","Listeners"]]){
  assert.ok(page.includes('id="'+id+'"'));
  assert.match(page,new RegExp(heading));
 }
 assert.match(page,/id="spaceActiveCount"/);
 assert.match(page,/id="spaceSpeakerCount"/);
 assert.match(page,/id="spaceListenerCount"/);
 const ids=[...page.matchAll(/\bid="([^"]+)"/g)].map(v=>v[1]);
 assert.equal(ids.length,new Set(ids).size,"unique DOM IDs");
 assert.match(source,/sdk\.RoomEvent\.ActiveSpeakersChanged/);
 assert.match(source,/state\.activeSpeakerIds=new Set/);
 assert.match(source,/renderPeople\(\);/);
});

test("active speakers, other speakers and listeners are exclusive categories",()=>{
 const begin=source.indexOf("function renderPeople(){");
 const end=source.indexOf("async function authenticateRoom(",begin);
 assert.ok(begin>0&&end>begin);
 const containers=new Map();
 const $=id=>{
  if(!containers.has(id))containers.set(id,{
   children:[],textContent:"",replaceChildren(){this.children=[]},
   append(child){this.children.push(child)}
  });
  return containers.get(id);
 };
 function el(tag,text="",className=""){
  return {tag,textContent:text,className,children:[],append(...args){this.children.push(...args)}};
 }
 const participants=[
  {user_id:"u1",role:"host"},{user_id:"u2",role:"speaker"},
  {user_id:"u3",role:"speaker"},{user_id:"u4",role:"listener"}
 ];
 const state={participants,activeSpeakerIds:new Set(["u1","u3"]),
  profiles:new Map(participants.map((p,i)=>[p.user_id,{display_name:"Person "+(i+1)}])),
  joined:false,user:null,room:null,mutedUsers:new Set()};
 const code="(function(d){const {state,$,el,verifiedAvatar,verifiedName}=d;"+
  source.slice(begin,end)+";return renderPeople;})";
 const fn=vm.runInNewContext(code,{},{timeout:1500})({
  state,$,el,verifiedAvatar:()=>"<avatar>",verifiedName:name=>name
 });
 fn();
 assert.equal($("spacesActiveSpeakers").children.length,2);
 assert.equal($("spacesSpeakers").children.length,1);
 assert.equal($("spacesListeners").children.length,1);
 assert.equal($("spaceActiveCount").textContent,"2 speaking");
 assert.equal($("spaceSpeakerCount").textContent,"1 ready");
 assert.equal($("spaceListenerCount").textContent,"1");
});

test("persistent audio handoff never revokes shared membership while both tabs connect",()=>{
 assert.match(source,/const SPACE_PRESENCE_KEY="timzee:space-window-v1"/);
 assert.match(source,/const SPACE_COMMAND_KEY="timzee:space-command-v1"/);
 assert.match(source,/await join\(\{enableMic:audioWindowRequested\?q\.get\("speak"\)==="1":true\}\)/);
 assert.match(source,/handoffRequested=true/);
 assert.match(source,/info\.connected===true/);
 assert.match(source,/void leave\(false\)/);
 assert.match(source,/Math\.abs\(Date\.now\(\)-command\.at\)>15000/);
 assert.match(source,/command\.owner!==POPUP_OWNER/);
 assert.match(source,/\["host","speaker"\]\.includes\(state\.role\)/);
 assert.match(source,/command\.action==="toggle-mic"/);
 assert.match(source,/publishSpacePresence\(\)/);
 assert.match(page,/target="timzee-space-audio"/);
 assert.match(page,/Keep audio while browsing/);
 assert.match(source,/space-popout-mode/);
});

test("site-wide dock controls the real popup without secretly acquiring audio",()=>{
 assert.match(mini,/siteSpaceAudioDock/);
 assert.match(mini,/SPACE|space-window-v1/);
 assert.match(mini,/commandKey="timzee:space-command-v1"/);
 assert.match(mini,/sendCommand\("toggle-mic"\)/);
 assert.match(mini,/sendCommand\("leave"\)/);
 assert.match(mini,/aria-pressed/);
 assert.match(mini,/validPresence/);
 assert.doesNotMatch(mini,/getUserMedia\s*\(/);
 assert.doesNotMatch(mini,/LivekitClient/);
 assert.match(read("assets/js/site-shell.js"),/space-mini-dock\.mjs/);
 assert.doesNotThrow(()=>new Function(mini));
});

test("viewport widths and compact audio window have bounded styles",()=>{
 assert.match(nav,/width:min\(365px,calc\(100vw - 20px\)\)/);
 assert.match(nav,/max-width:calc\(100vw - 20px\)/);
 assert.match(style,/space-session-layout\{grid-template-columns:minmax\(0,1fr\)/);
 assert.match(style,/\.spaces-shell\{max-width:100%;width:100%;padding-inline:10px\}/);
 assert.match(style,/\.space-people-panel \.space-people\{grid-template-columns:repeat\(auto-fill,minmax\(min\(100%,96px\),1fr\)\)/);
 assert.match(style,/\.space-popout-mode \.speaker-stage/);
 assert.match(style,/@media\(max-width:350px\)/);
 assert.match(style,/@media\(prefers-reduced-motion:reduce\)/);
 const js=source.replace(/^import[\s\S]*?from\s+"[^"]+";\s*$/gm,"");
 assert.doesNotThrow(()=>new Function(js));
});
