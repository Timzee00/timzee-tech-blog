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

test("speaking requests resolve public usernames without exposing internal IDs or email",async()=>{
 const vm=require("node:vm");
 const start=ui.indexOf("async function loadRequests(){");
 const end=ui.indexOf("async function inviteListener(event){",start);
 assert.ok(start>=0&&end>start);
 const roomId="11111111-2222-4333-8444-555555555555";
 const requester="11111111-2222-4333-8444-666666666666";
 const elements=new Map();
 const $=id=>{
  if(!elements.has(id))elements.set(id,{children:[],replaceChildren(){this.children=[]},append(...items){this.children.push(...items)}});
  return elements.get(id);
 };
 const el=(tag,text="",className="")=>({
  tag,textContent:text,className,innerHTML:"",children:[],
  append(...items){this.children.push(...items)}
 });
 const calls=[];
 const db={
  from(table){
   const chain={
    select(fields){calls.push({table,fields});return chain},
    eq(){return chain},
    in(){return chain},
    limit(){return Promise.resolve({data:table==="spaces_speaker_requests"?
      [{user_id:requester,status:"pending"}]:
      [{id:requester,username:"sample_creator",avatar_url:null}],error:null})}
   };
   return chain;
  },
  rpc(method,args){calls.push({method,args});return Promise.resolve({data:true,error:null})}
 };
 const state={
  room:{id:roomId,owner_id:"host"},user:{id:"host"},profiles:new Map(),
  speakerRequestLoadId:0
 };
 const code="(function(d){const {state,$,el,button,supabase,success,validId,alertStatus,loadPeople,verifiedAvatar}=d;"+
   ui.slice(start,end)+";return loadRequests;})";
 const create=vm.runInNewContext(code,{}, {timeout:1200});
 let review;
 const loadRequests=create({
  state,$,el,supabase:db,success:r=>r.data,
  validId:s=>/^[0-9a-f-]{36}$/.test(s),alertStatus(){},
  verifiedAvatar:()=>"<avatar>",loadPeople:async()=>{},
  button:(label,handler)=>{if(label==="Approve")review=handler;return el("button",label)}
 });
 await loadRequests();
 const rows=$("spaceRequests").children;
 assert.equal(rows.length,1);
 assert.equal(rows[0].children[0].children.at(-1).textContent,"@sample_creator");
 assert.ok(!JSON.stringify(rows).includes(requester),"UUID is internal, never visible in markup");
 assert.ok(calls.some(call=>call.table==="public_profiles"&&call.fields.includes("username")));
 assert.ok(!calls.some(call=>call.fields?.includes("email")));
});
