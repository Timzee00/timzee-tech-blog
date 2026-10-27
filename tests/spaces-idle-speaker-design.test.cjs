const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const read=file=>fs.readFileSync(file,"utf8");
const source=read("assets/js/live-spaces.mjs");
const page=read("spaces.html");
const css=read("assets/css/live-spaces.css");

function simulatePeople(activeIds=[]){
 const begin=source.indexOf("function renderPeople(){");
 const end=source.indexOf("function showIdleStage(",begin);
 assert.ok(begin>=0&&end>begin,"Rendering block must remain available");
 const elements=new Map();
 const $=id=>{
  if(!elements.has(id))elements.set(id,{
   children:[],textContent:"",
   replaceChildren(){this.children=[]},
   append(node){this.children.push(node)}
  });
  return elements.get(id);
 };
 const el=(tag,text="",className="")=>({
  tag,textContent:text,className,children:[],
  append(...nodes){this.children.push(...nodes)}
 });
 const participants=[
  {user_id:"u1",role:"host"},
  {user_id:"u2",role:"speaker"},
  {user_id:"u3",role:"listener"}
 ];
 const state={
  participants,activeSpeakerIds:new Set(activeIds),
  profiles:new Map(participants.map((p,i)=>[p.user_id,{display_name:"Voice "+(i+1)}])),
  joined:false,user:null,room:null,mutedUsers:new Set()
 };
 const fn=vm.runInNewContext(
  "(function(d){const {state,$,el,verifiedAvatar,verifiedName}=d;"+
   source.slice(begin,end)+";return renderPeople;})",
  {},{timeout:1500}
 )({state,$,el,verifiedAvatar:()=>"<avatar>",verifiedName:n=>n});
 return {fn,$,state};
}

test("empty Speaking now section shows illustrated No active speaker state",()=>{
 const {fn,$}=simulatePeople();
 fn();
 const items=$("spacesActiveSpeakers").children;
 assert.equal(items.length,1);
 assert.equal(items[0].className,"space-no-active-speaker");
 assert.deepEqual(Array.from(items[0].children,c=>c.className),
  ["space-no-active-icon","space-no-active-title","space-no-active-description"]);
 assert.equal(items[0].children[1].textContent,"No active speaker");
 assert.equal($("spaceActiveCount").textContent,"0 speaking");
 assert.equal($("spacesSpeakers").children.length,2,"ready speakers remain visible");
 assert.equal($("spacesListeners").children.length,1);
});

test("idle art vanishes as soon as a real speaker becomes active and returns on silence",()=>{
 const {fn,$,state}=simulatePeople();
 fn();
 assert.equal($("spacesActiveSpeakers").children[0].className,"space-no-active-speaker");
 state.activeSpeakerIds.add("u2");
 fn();
 assert.equal($("spacesActiveSpeakers").children.length,1);
 assert.equal($("spacesActiveSpeakers").children[0].className,"space-person");
 assert.equal($("spaceActiveCount").textContent,"1 speaking");
 assert.equal($("spacesSpeakers").children.length,1);
 state.activeSpeakerIds.clear();
 fn();
 assert.equal($("spacesActiveSpeakers").children[0].className,"space-no-active-speaker");
});

test("stage is idle on first render, goes live on speaking event, returns on silence",()=>{
 assert.match(page,/class="speaker-stage is-idle"/);
 assert.match(page,/id="activeSpeaker">No active speaker/);
 assert.match(source,/sdk\.RoomEvent\.ActiveSpeakersChanged/);
 assert.match(source,/if\(speakers\.length\)setSpeaking\(speakers\[0\]\.identity,true\);/);
 assert.match(source,/else showIdleStage\(\);/);
 assert.match(source,/state\.activeSpeakerIds\.clear\(\);\s*showIdleStage\("Audio disconnected/);
 const start=source.indexOf("function showIdleStage(");
 const end=source.indexOf("async function authenticateRoom(",start);
 const nodes=new Map();
 const $=id=>{
  if(!nodes.has(id))nodes.set(id,{
   textContent:"",innerHTML:"",classList:{
    values:new Set(),remove(n){this.values.delete(n)},
    add(n){this.values.add(n)},
    toggle(n,v){v?this.values.add(n):this.values.delete(n)}
   }
  });
  return nodes.get(id);
 };
 const stage={classList:{values:new Set(),add(n){this.values.add(n)},
  toggle(n,v){v?this.values.add(n):this.values.delete(n)}}};
 const fakeDoc={querySelector:()=>stage};
 const fn=vm.runInNewContext(
  "(function(d){const {$,state,document,verifiedAvatar}=d;"+
  source.slice(start,end)+";return {showIdleStage,setSpeaking};})",
  {},{timeout:1500}
 )({$,state:{profiles:new Map([["person",{display_name:"On mic"}]])},
  document:fakeDoc,verifiedAvatar:()=>"<avatar>"});
 fn.showIdleStage();
 assert.equal($("activeSpeaker").textContent,"No active speaker");
 assert.equal($("activeSpeakerLabel").textContent,"STAGE IS QUIET");
 assert.ok(stage.classList.values.has("is-idle"));
 fn.setSpeaking("person",true);
 assert.equal($("activeSpeaker").textContent,"On mic");
 assert.equal($("activeSpeakerLabel").textContent,"SPEAKING NOW");
 assert.ok(!stage.classList.values.has("is-idle"));
 fn.showIdleStage();
 assert.equal($("activeSpeaker").textContent,"No active speaker");
});

test("idle design is bounded in mobile viewport and respects reduced motion",()=>{
 assert.match(css,/\.space-active-panel \.space-no-active-speaker\{/);
 assert.match(css,/width:100%;max-width:100%;min-width:0;min-height:194px/);
 assert.match(css,/background:\s*radial-gradient/);
 assert.match(css,/overflow:hidden;text-align:center/);
 assert.match(css,/\.speaker-stage\.is-idle \.space-waveform i\{animation:none/);
 assert.match(css,/@media\(max-width:400px\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\s*\.space-no-active-icon\{animation:none\}/);
 assert.doesNotThrow(()=>new Function(source.replace(/^import[\s\S]*?from\s+"[^"]+";\s*$/gm,"")));
});
