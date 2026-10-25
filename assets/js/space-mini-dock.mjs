// This lightweight dock runs on all public pages but never captures audio.
// A separately opened Space window owns the real LiveKit connection.
const key="timzee:space-window-v1";
const ROOT="/spaces.html";
let shownId=null;
const root=document.createElement("aside");
root.className="site-space-audio-dock";
root.id="siteSpaceAudioDock";
root.setAttribute("aria-label","Active Space audio");
root.hidden=true;
function render(){
 let value=null;
 try{value=JSON.parse(localStorage.getItem(key)||"null")}catch{}
 if(!value||!/^[-a-f0-9]{36}$/i.test(value.roomId||"")||!Number.isFinite(value.seen)||Date.now()-value.seen>90000){
   root.hidden=true;shownId=null;return;
 }
 if(shownId===value.roomId&&root.isConnected){root.hidden=false;return}
 shownId=value.roomId;
 const title=document.createElement("strong");
 title.textContent="🔊 Space playing";
 const name=document.createElement("span");
 name.textContent=String(value.title||"Live conversation").slice(0,80);
 const open=document.createElement("a");
 open.href=ROOT+"?room="+encodeURIComponent(value.roomId)+"&mini=1";
 open.target="timzee-space-audio";
 open.textContent="Open controls";
 open.setAttribute("aria-label","Open audio controls for "+name.textContent);
 root.replaceChildren(title,name,open);
 root.hidden=false;
}
function mount(){if(!document.body)return;document.body.append(root);render()}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",mount,{once:true});
else mount();
window.addEventListener("storage",event=>{if(event.key===key)render()});
window.addEventListener("pageshow",render);
window.setInterval(render,15000);
