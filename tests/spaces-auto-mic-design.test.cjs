const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const read=path=>fs.readFileSync(path,"utf8");
const html=read("spaces.html");
const ui=read("assets/js/live-spaces.mjs");
const styles=read("assets/css/live-spaces.css");
const sql=read("supabase/migrations/20261027204500_spaces_open_mic_rooms.sql");
const compat=read("supabase/migrations/20261027205000_spaces_open_mic_opt_in_backcompat.sql");

test("Spaces 2.0 has a responsive stage, clear consent, accessible mic toggle and audience",()=>{
 for(const id of ["spaceActionDock","spaceRoleNotice","spaceJoinHint","spaceStageHint","activeSpeakerAvatar",
  "spacesSpeakers","spacesListeners","spaceMic","spaceJoin","spacesSpeakingMode","spacesRequestField"]){
  assert.match(html,new RegExp('id="'+id+'"'));
 }
 assert.match(html,/Mic transparency:/);
 assert.match(html,/after you grant browser permission/);
 assert.match(html,/aria-pressed="false"/);
 assert.match(html,/option value="open">Open mic/);
 assert.match(html,/option value="request">Host-approved/);
 assert.match(styles,/\.space-session-layout/);
 assert.match(styles,/\.space-action-dock/);
 assert.match(styles,/@media\(max-width:700px\)/);
 assert.match(styles,/@media\(prefers-reduced-motion:reduce\)/);
 const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
 assert.equal(ids.length,new Set(ids).size,"DOM ids must be unique");
});

test("new room mode is chosen explicitly and legacy clients cannot accidentally unmute",()=>{
 assert.match(ui,/speaking_mode:f\.speaking_mode==="request"\?"request":"open"/);
 assert.match(sql,/ADD COLUMN IF NOT EXISTS speaking_mode text NOT NULL DEFAULT 'request'/);
 assert.match(sql,/WHEN r\.speaking_mode='open' THEN 'speaker'/);
 assert.match(sql,/WHEN r\.speaking_mode='open' AND public\.spaces_participants\.role='listener' THEN 'speaker'/);
 assert.match(sql,/state='removed'/);
 assert.match(sql,/r\.visibility='invite'/);
 assert.match(sql,/r\.capacity/);
 assert.match(sql,/REVOKE ALL ON FUNCTION public\.spaces_join\(uuid\) FROM PUBLIC,anon/);
 assert.match(compat,/ALTER COLUMN speaking_mode SET DEFAULT 'request'/);
});

test("creator auto-joins own live Space, while listeners cannot escalate without server permission",()=>{
 assert.match(ui,/hostIsLive\|\|audioWindowRequested\|\|joinImmediately/);
 assert.match(ui,/Date\.now\(\)>=Date\.parse\(state\.room\.starts_at\)/);
 assert.match(ui,/await join\(\{enableMic:!audioWindowRequested\|\|hostIsLive\}\)/);
 assert.match(ui,/await supabase\.rpc\("spaces_join"/);
 assert.match(ui,/\["host","speaker"\]\.includes\(grant\.role\)/);
 assert.match(ui,/state\.role==="listener"&&self\?\.role==="speaker"/);
 assert.match(ui,/const restoreMic=state\.desiredMic\|\|state\.role==="listener"/);
 assert.match(ui,/state\.joining=true/);
 assert.match(ui,/await prepareMicrophone\(\)/);
 const code=ui.replace(/^import[\s\S]*?from\s+"[^"]+";\s*$/gm,"").replace(/^import\s+"[^"]+";\s*$/gm,"");
 assert.doesNotThrow(()=>new Function(code));
});

// Media handshake is simulated: this does not contact a provider or request
// physical microphone permission.
async function simulate(role,{enableMic=true,denyMic=false}={}){
 const start=ui.indexOf("async function startAudio(");
 const end=ui.indexOf("async function connectJoinedRoom(",start);
 assert.ok(start>0&&end>start);
 const fragment=ui.slice(start,end);
 const statuses=[];
 let published=0,room;
 class FakeRoom{
  constructor(){
   room=this;
   this.localParticipant={
    isMicrophoneEnabled:false,
    async setMicrophoneEnabled(value){
     if(value&&denyMic)throw Error("Permission denied");
     published+=Number(value);
     this.isMicrophoneEnabled=value;
    }
   };
   this.canPlaybackAudio=true;
  }
  on(){return this}
  async connect(){}
  disconnect(){}
 }
 const sdk={
  Room:FakeRoom,
  RoomEvent:{TrackSubscribed:"TrackSubscribed",TrackUnsubscribed:"TrackUnsubscribed",
   ActiveSpeakersChanged:"ActiveSpeakersChanged",DataReceived:"DataReceived",
   ParticipantConnected:"ParticipantConnected",ParticipantDisconnected:"ParticipantDisconnected",
   Disconnected:"Disconnected"},
  Track:{Kind:{Audio:"audio"}}
 };
 const state={roomId:"room",mutedUsers:new Set(),profiles:new Map(),
  desiredMic:false,micPermissionError:"",role:"listener",livekit:null};
 const deps={state,window:{LivekitClient:sdk},q:{get:()=>null},
  $:()=>({hidden:true}),authenticateRoom:async()=>({
   role,server_url:"wss://mock.invalid/",participant_token:"test"}),
  audioStatus:msg=>statuses.push(msg),configureControls:()=>{}};
 const make=vm.runInNewContext("(function(d){const {state,window,q,$,authenticateRoom,audioStatus,configureControls}=d;"+
    fragment+";return startAudio;})",{TextDecoder,TextEncoder,JSON,Error},{timeout:1500});
 await make(deps)({enableMic});
 return {state,statuses,published,room};
}

test("hosts and approved speakers broadcast immediately after joining",async()=>{
 for(const role of ["host","speaker"]){
  const done=await simulate(role);
  assert.equal(done.state.desiredMic,true,role);
  assert.equal(done.published,1,role);
  assert.match(done.statuses.at(-1),/Microphone live/);
 }
});

test("host-approved listeners never broadcast just by joining",async()=>{
 const done=await simulate("listener");
 assert.equal(done.published,0);
 assert.equal(done.state.desiredMic,false);
 assert.match(done.statuses.at(-1),/You're listening/);
});

test("microphone rejection keeps playback connected and offers recovery",async()=>{
 const done=await simulate("speaker",{denyMic:true});
 assert.equal(done.state.desiredMic,false);
 assert.equal(done.state.livekit,done.room);
 assert.match(done.statuses.at(-1),/permission|Microphone/i);
});
