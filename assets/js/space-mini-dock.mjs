// This site-wide mini player never acquires microphone access.
// One explicit, persistent Space window owns the LiveKit stream while
// ordinary Blipmood pages can be navigated or reloaded independently.
const key="timzee:space-window-v1";
const commandKey="timzee:space-command-v1";
const ROOT="/spaces.html";
const ageLimitMs=90000;
const roomPattern=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const root=document.createElement("aside");
root.className="site-space-audio-dock";
root.id="siteSpaceAudioDock";
root.setAttribute("aria-label","Persistent Blipmood Space audio");
root.hidden=true;
const title=document.createElement("strong");
title.className="space-dock-title";
title.textContent="● LIVE SPACE";
const name=document.createElement("span");
name.className="space-dock-name";
const status=document.createElement("span");
status.className="space-dock-status";
status.setAttribute("aria-live","polite");
const actions=document.createElement("div");
actions.className="space-dock-actions";
const mic=document.createElement("button");
mic.type="button";mic.className="space-dock-mic";
const open=document.createElement("a");
open.href=ROOT;
open.target="timzee-space-audio";
open.rel="noopener noreferrer";
open.textContent="Open";
open.setAttribute("aria-label","Open your separate Space audio window");
const leave=document.createElement("button");
leave.type="button";leave.className="space-dock-leave";leave.textContent="Leave";
leave.setAttribute("aria-label","Leave live Space on your other audio window");
actions.append(mic,open,leave);
root.append(title,name,status,actions);
let current=null;
function validPresence(data){
 return data&&roomPattern.test(data.roomId||"")&&
  typeof data.owner==="string"&&data.owner.length>8&&
  data.connected===true&&Number.isFinite(data.seen)&&
  Math.abs(Date.now()-data.seen)<ageLimitMs;
}
function render(){
 let value=null;
 try{value=JSON.parse(localStorage.getItem(key)||"null")}catch{}
 if(!validPresence(value)){current=null;root.hidden=true;return}
 current=value;
 root.hidden=false;
 name.textContent=String(value.title||"Live conversation").slice(0,80);
 const allowed=value.role==="host"||value.role==="speaker";
 const isOn=allowed&&value.micOn===true;
 title.textContent=isOn?"● ON AIR · YOUR MIC IS LIVE":"● SPACE CONNECTED";
 status.textContent=allowed?
  (isOn?"Your voice can be heard":"Your microphone is muted"):
  "You're listening to this Space";
 mic.hidden=!allowed;
 mic.textContent=isOn?"Mute mic":"Turn on mic";
 mic.setAttribute("aria-pressed",String(isOn));
 mic.setAttribute("aria-label",isOn?"Mute your Space microphone":"Unmute your Space microphone");
 open.href=ROOT+"?room="+encodeURIComponent(value.roomId)+"&mini=1";
}
function sendCommand(action){
 const info=current;
 if(!validPresence(info))return;
 try{
  localStorage.setItem(commandKey,JSON.stringify({
   id:crypto.randomUUID(),roomId:info.roomId,owner:info.owner,
   action,at:Date.now()
  }));
  status.textContent=action==="leave"?"Sending leave request…":"Switching microphone…";
 }catch{status.textContent="Could not contact your Space window. Open it to manage audio."}
}
mic.addEventListener("click",()=>sendCommand("toggle-mic"));
leave.addEventListener("click",()=>sendCommand("leave"));
function mount(){
 if(!document.body)return;
 document.body.append(root);render();
}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount,{once:true});
else mount();
window.addEventListener("storage",event=>{if(event.key===key)render()});
window.addEventListener("pageshow",render);
window.setInterval(render,15000);
