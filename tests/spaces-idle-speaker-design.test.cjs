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
 const end=source.indexOf("async function authenticateRoom(",begin);
 assert.ok(begin>=0&&end>begin,"Live speaker rendering block must exist");
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
  tag,textContent:text,className,children:[],attrs:{},
  setAttribute(name,value){this.attrs[name]=value},
  append(...nodes){this.children.push(...nodes)}
 });
 const participants=[
  {user_id:"u1",role:"host"},
  {user_id:"u2",role:"speaker"},
  {user_id:"u3",role:"listener"}
 ];
 const state={
  participants,activeSpeakerIds:new Set(activeIds),speakingStatusHint:"",
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

test("only the preferred lower panel remains; the upper green stage is removed",()=>{
 assert.match(page,/class="space-people-panel space-active-panel"/);
 assert.match(page,/id="spacesActiveSpeakers"/);
 assert.doesNotMatch(page,/class="speaker-stage/);
 assert.doesNotMatch(page,/id="activeSpeakerAvatar"/);
 assert.doesNotMatch(page,/id="activeSpeakerLabel"/);
 assert.doesNotMatch(page,/id="spaceStageHint"/);
 assert.doesNotMatch(source,/showIdleStage|setSpeaking|document\.querySelector\("\.speaker-stage"/);
 assert.match(page,/id="spacesSpeakers"/);
 assert.match(page,/id="spacesListeners"/);
});

test("silence shows one beautiful No active speaker panel, not two",()=>{
 const {fn,$}=simulatePeople();
 fn();
 const items=$("spacesActiveSpeakers").children;
 assert.equal(items.length,1);
 assert.equal(items[0].className,"space-no-active-speaker");
 assert.deepEqual(Array.from(items[0].children,c=>c.className),
  ["space-no-active-icon","space-no-active-title","space-no-active-description"]);
 assert.equal(items[0].children[1].textContent,"No active speaker");
 assert.equal($("spaceActiveCount").textContent,"0 speaking");
 assert.equal($("spacesSpeakers").children.length,2);
 assert.equal($("spacesListeners").children.length,1);
});

test("speaker replaces the idle art with a spotlight, visible name/avatar and waveform",()=>{
 const {fn,$,state}=simulatePeople();
 fn();
 state.activeSpeakerIds.add("u2");
 fn();
 const active=$("spacesActiveSpeakers").children;
 assert.equal(active.length,1);
 const featured=active[0];
 assert.equal(featured.className,"space-person space-speaking-spotlight");
 assert.equal(featured.children[0].textContent,"● ON AIR");
 assert.ok(featured.children.some(child=>child.className==="space-person-avatar"));
 assert.ok(featured.children.some(child=>child.textContent==="Voice 2"));
 const wave=featured.children.find(child=>child.className==="space-speaking-wave");
 assert.equal(wave.attrs["aria-hidden"],"true");
 assert.equal(wave.children.length,5);
 assert.equal($("spaceActiveCount").textContent,"1 speaking");
 assert.equal($("spacesSpeakers").children.length,1);
 state.activeSpeakerIds.clear();
 fn();
 assert.equal($("spacesActiveSpeakers").children.length,1);
 assert.equal($("spacesActiveSpeakers").children[0].className,"space-no-active-speaker");
});

test("multiple talking participants remain in Speaking now; no duplicate focus card",()=>{
 const {fn,$,state}=simulatePeople(["u1","u2"]);
 fn();
 const active=$("spacesActiveSpeakers").children;
 assert.equal(active.length,2);
 assert.equal(active.filter(node=>node.className.includes("space-speaking-spotlight")).length,1);
 assert.equal($("spaceActiveCount").textContent,"2 speaking");
 assert.equal($("spacesSpeakers").children.length,1,"only listener stays outside speaker sections");
 assert.equal($("spacesListeners").children.length,1);
 state.speakingStatusHint="Audio disconnected. Reconnect to hear this Space.";
 state.activeSpeakerIds.clear();
 fn();
 assert.match($("spacesActiveSpeakers").children[0].children[2].textContent,/Audio disconnected/);
});

test("live audio signal updates only the unified panel and keeps other controls",()=>{
 assert.match(source,/sdk\.RoomEvent\.ActiveSpeakersChanged/);
 assert.match(source,/state\.activeSpeakerIds=new Set\(speakers\.map/);
 assert.match(source,/state\.speakingStatusHint="";\s*renderPeople\(\)/);
 assert.match(source,/state\.speakingStatusHint="Audio disconnected\. Reconnect to hear this Space\."/);
 assert.match(source,/row\.append\(button\(muted\?"Unmute here":"Mute for me"/);
 assert.match(source,/row\.append\(button\("Remove"/);
 assert.match(source,/verifiedAvatar\(profile\?\.avatar_url,profile,\{size:isFeatured\?"xl":"lg"/);
});

test("unified panel retains the preferred backdrop, viewport bounds and reduced motion",()=>{
 assert.match(css,/\.space-active-panel \.space-no-active-speaker\{/);
 assert.match(css,/\.space-active-panel \.space-speaking-spotlight\{/);
 assert.match(css,/width:100%;max-width:100%;min-width:0;min-height:205px/);
 assert.match(css,/\.space-speaking-wave i/);
 assert.match(css,/@media\(max-width:400px\)/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\.space-speaking-wave i\{animation:none/);
 assert.doesNotThrow(()=>new Function(source.replace(/^import[\s\S]*?from\s+"[^"]+";\s*$/gm,"")));
});
