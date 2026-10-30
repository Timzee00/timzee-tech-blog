// Intro based on the previously approved Timzee Tech Hub cinematic concept,
// rebranded for Blipmood and reused with the actual first-party brand assets.
// Only the homepage plays automatically; other pages are never interrupted.
const KEY="blipmood:intro:seen:v1";
let active=null;
let loading=null;
const currentIsHome=()=>location.pathname==="/"||location.pathname==="/index.html";
const skipForAccessibility=()=>{
  if(document.documentElement.dataset.reduceMotion==="true")return true;
  if(window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches)return true;
  const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  return !!(connection?.saveData||/(?:slow-2g|2g)/.test(connection?.effectiveType||""));
};
export function shouldShowIntro(){
  if(!currentIsHome()||skipForAccessibility()||active)return false;
  try{return localStorage.getItem(KEY)!=="1"}catch{return false}
}
function markSeen(){try{localStorage.setItem(KEY,"1")}catch{}}
const nodes=[
  {x:300,y:85,initial:"D",name:"DISCUSS"},
  {x:486,y:192.5,initial:"V",name:"REELS"},
  {x:486,y:407.5,initial:"A",name:"AI CHAT"},
  {x:300,y:515,initial:"M",name:"MARKET"},
  {x:114,y:407.5,initial:"S",name:"STORIES"},
  {x:114,y:192.5,initial:"L",name:"SPACES"}
];
function svg(){
  const rays=nodes.map((n,i)=>'<line class="bmci-ray" style="--i:'+i+'" x1="300" y1="300" x2="'+n.x+'" y2="'+n.y+'"/>').join("");
  const planets=nodes.map((n,i)=>
    '<g transform="translate('+n.x+' '+n.y+')"><g class="bmci-node" style="--i:'+i+'">'+
    '<circle r="27"/><text y="8">'+n.initial+'</text><text y="-47">'+n.name+'</text></g></g>').join("");
  return '<svg viewBox="0 0 600 600" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">'+
    '<circle class="bmci-ring outer" cx="300" cy="300" r="248"/>'+
    '<circle class="bmci-ring inner" cx="300" cy="300" r="167"/>'+rays+
    '<circle class="bmci-pulse" cx="300" cy="300" r="91"/>'+planets+
    '<g class="bmci-center"><circle cx="300" cy="300" r="91" fill="#7475e523"/>'+
    '<circle class="bmci-core-disc" cx="300" cy="300" r="73"/>'+
    '<text class="bmci-core-letter" x="300" y="325">B</text>'+
    '<image href="/assets/brand/blipmood-emblem-dark.png" x="245" y="245" width="110" height="110" preserveAspectRatio="xMidYMid meet"/>'+
    '</g></svg>';
}
function markup(){
 return '<div id="bm-cinema-intro" role="dialog" aria-modal="true" aria-labelledby="bmci-title" aria-describedby="bmci-desc">'+
   '<header class="bmci-top">'+
     '<div class="bmci-identity"><img src="/assets/brand/blipmood-emblem-dark.png" width="35" height="35" alt=""><span>BLIPMOOD</span></div>'+
     '<div class="bmci-status"><span>WELCOME TO YOUR WORLD</span></div>'+
   '</header>'+
   '<section class="bmci-stage">'+
     '<div class="bmci-art">'+svg()+'</div>'+
     '<p class="bmci-eyebrow">Discover. Connect. Create.</p>'+
     '<h2 class="bmci-sr" id="bmci-title">Welcome to Blipmood</h2>'+
     '<div class="bmci-wordmark" id="bmci-wordmark">'+
       '<img class="bmci-static-logo" src="/assets/brand/blipmood-wordmark-dark.png" width="430" height="143" alt="">'+
     '</div>'+
     '<p class="bmci-tagline" id="bmci-desc">Your world. Your mood.</p>'+
     '<div class="bmci-tags" aria-label="Discover Blipmood features">'+
       '<span>Discussions</span><span>Reels</span><span>Marketplace</span>'+
       '<span>Stories</span><span>Spaces</span><span>AI chat</span>'+
     '</div>'+
   '</section>'+
   '<footer class="bmci-bottom">'+
     '<div class="bmci-progress" aria-hidden="true">'+
       '<div class="bmci-progress-label"><span>CONNECTING THE DOTS</span><span>● ● ●</span></div>'+
       '<div class="bmci-progress-track"><span class="bmci-progress-bar"></span></div>'+
     '</div>'+
     '<button type="button" class="bmci-skip" id="bmci-skip">Skip intro <span aria-hidden="true">↗</span></button>'+
   '</footer>'+
 '</div>';
}
function readyStyles(){
 if(loading)return loading;
 loading=new Promise(resolve=>{
   const existing=document.querySelector('link[data-blipmood-cinema]');
   if(existing){resolve(true);return;}
   const link=document.createElement("link");
   link.rel="stylesheet";link.href="/assets/css/blipmood-intro.css";
   link.dataset.blipmoodCinema="1";
   let settled=false;
   const done=(ok)=>{if(settled)return;settled=true;clearTimeout(t);resolve(ok)};
   const t=setTimeout(()=>done(false),1500);
   link.onload=()=>done(true);
   link.onerror=()=>done(false);
   document.head.append(link);
 });
 return loading;
}
function enhanceWithRealLogo(overlay){
 if(skipForAccessibility())return;
 void import("./blipmood-logo.js").then(async()=>{
   if(active?.overlay!==overlay||!overlay.isConnected)return;
   const wrapper=overlay.querySelector("#bmci-wordmark");
   const logo=document.createElement("blipmood-logo");
   logo.setAttribute("aria-hidden","true");
   logo.setAttribute("theme","dark");
   logo.setAttribute("autoplay","false");
   logo.setAttribute("replay","none");
   logo.setAttribute("idle","false");
   wrapper.append(logo);
   const imgs=[...logo.shadowRoot.querySelectorAll("img[data-k]")];
   try{await Promise.all(imgs.map(img=>img.decode()))}
   catch{logo.remove();return}
   if(active?.overlay!==overlay||skipForAccessibility())return;
   wrapper.classList.add("bmci-enhanced");
   logo.play();
 }).catch(()=>{/* the approved static wordmark remains visible */});
}
export async function playIntro({force=false}={}){
 if(active)return false;
 if(!force&&!shouldShowIntro())return false;
 if(skipForAccessibility())return false;
 if(!force)markSeen();
 const styled=await readyStyles();
 if(!styled||active)return false;
 const previouslyFocused=document.activeElement;
 const previousOverflow=document.body.style.overflow;
 const overlay=document.createElement("div");
 overlay.innerHTML=markup();
 const dialog=overlay.firstElementChild;
 document.body.append(dialog);
 document.body.style.overflow="hidden";
 let dismissed=false;
 let timer=null;
 const focusSkip=()=>dialog.querySelector("#bmci-skip")?.focus({preventScroll:true});
 const keydown=(e)=>{
   if(!dialog.isConnected)return;
   if(e.key==="Escape"){e.preventDefault();dismiss();return}
   if(e.key==="Tab"){e.preventDefault();focusSkip()}
 };
 function dismiss(){
   if(dismissed)return;
   dismissed=true;
   clearTimeout(timer);
   document.removeEventListener("keydown",keydown,true);
   dialog.classList.add("bmci-out");
   const finish=()=>{
     dialog.remove();
     document.body.style.overflow=previousOverflow;
     if(active?.overlay===dialog)active=null;
     const target=previouslyFocused?.isConnected && previouslyFocused!==document.body
       ?previouslyFocused:document.querySelector(".site-header a.brand");
     target?.focus?.({preventScroll:true});
   };
   setTimeout(finish,720);
 }
 active={overlay:dialog,dismiss};
 dialog.querySelector("#bmci-skip").addEventListener("click",dismiss);
 document.addEventListener("keydown",keydown,true);
 requestAnimationFrame(()=>{if(!dismissed)dialog.classList.add("bmci-play")});
 focusSkip();
 timer=setTimeout(dismiss,3900);
 enhanceWithRealLogo(dialog);
 return true;
}
export function skipIntro(){active?.dismiss?.()}
