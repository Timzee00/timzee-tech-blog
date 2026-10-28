// Lightweight first-visit illustration. The hero is CSS/SVG-like layout, not
// a screenshot pasted into the application; buttons and close remain real UI.
const KEY="blipmood:welcome:v2";
const current=location.pathname.split("/").pop()||"index.html";
const DURATION=14*24*60*60*1000;
const before=()=>{try{return Number(localStorage.getItem(KEY)||0)}catch{return 0}};
function build(){
 // Returning signed-in members already have a home; don't interrupt them.
 if(document.querySelector('#authActions a[href*="profile.html"]'))return;
 if(current!=="index.html"||Date.now()-before()<DURATION||
   document.getElementById("bmWelcomeModal")||
   document.getElementById("siteAnnouncementBanner"))return;
 const backdrop=document.createElement("div");backdrop.className="bm-welcome-backdrop";backdrop.id="bmWelcomeBackdrop";
 const dialog=document.createElement("div");dialog.className="bm-welcome-hero";dialog.id="bmWelcomeModal";
 dialog.setAttribute("role","dialog");dialog.setAttribute("aria-modal","true");dialog.setAttribute("aria-labelledby","bmWelcomeHeading");
 const logo=document.querySelector(".bm-wordmark-image")?.src||"";
 dialog.innerHTML=`
  <button type="button" class="bm-welcome-close" aria-label="Close welcome banner">×</button>
  <div class="bm-welcome-orb bm-orb-one"></div><div class="bm-welcome-orb bm-orb-two"></div>
  <div class="bm-welcome-cards bm-welcome-left"><img src="/assets/img/avatar-female.svg" alt=""><span>❤ <small>Real people.<br>Real vibes.</small></span></div>
  <div class="bm-welcome-cards bm-welcome-right"><img src="/assets/img/avatar-male.svg" alt=""><span>✦ <small>Find your<br>people.</small></span></div>
  <div class="bm-welcome-center">
   <div class="bm-welcome-mark">${logo?'<img src="'+logo+'" alt="Blipmood">':'<b>Blipmood</b>'}</div>
   <p class="bm-welcome-overline">THE COMMUNITY IS YOURS</p>
   <h2 id="bmWelcomeHeading">Your world. <em>your vibe,</em><br><span>your community.</span></h2>
   <p class="bm-welcome-sub">Discover videos, conversations, trends and communities — all in one place.</p>
   <div class="bm-welcome-buttons"><a href="/login.html?view=signup" class="bm-welcome-join">Get started <span aria-hidden="true">→</span></a><a href="/fyp.html" class="bm-welcome-explore">Explore</a></div>
  </div>
  <div class="bm-welcome-skyline" aria-hidden="true"><span class="bm-buildings"></span></div>
  <div class="bm-welcome-features"><span>▷ <small>Watch great videos</small></span><span>♧ <small>Join real conversations</small></span><span>✧ <small>Explore communities</small></span></div>`;
 const close=()=>{
  try{localStorage.setItem(KEY,String(Date.now()))}catch{}
  dialog.remove();backdrop.remove();
  document.body.classList.remove("bm-welcome-open");
 };
 dialog.querySelector(".bm-welcome-close").addEventListener("click",close);
 backdrop.addEventListener("click",close);
 dialog.querySelectorAll("a").forEach(link=>link.addEventListener("click",close));
 const escape=event=>{if(event.key==="Escape"){close();document.removeEventListener("keydown",escape);}};
 document.addEventListener("keydown",escape);
 document.body.append(backdrop,dialog);document.body.classList.add("bm-welcome-open");
 dialog.querySelector(".bm-welcome-close").focus();
}
const style=document.createElement("style");style.id="bm-welcome-styles";style.textContent=`
.bm-welcome-open{overflow:hidden}
.bm-welcome-backdrop{position:fixed;inset:0;z-index:98998;background:#04071cbd;backdrop-filter:blur(9px)}
.bm-welcome-hero{position:fixed;inset:50% auto auto 50%;transform:translate(-50%,-50%);z-index:98999;
 isolation:isolate;width:min(950px,calc(100vw - 24px));max-height:calc(100dvh - 32px);min-height:500px;
 overflow:auto;border:2px solid #ac71ff;border-radius:30px;background:radial-gradient(ellipse at 52% 7%,#624df39a,transparent 48%),
 radial-gradient(ellipse at 6% 85%,#b52eb258,transparent 48%),
 radial-gradient(ellipse at 91% 71%,#254edd70,transparent 44%),linear-gradient(145deg,#0a1b56,#160c3c 60%,#071330);
 box-shadow:0 0 55px #8a50fa44,0 35px 90px #000b;color:#fff;padding:30px 22px 24px;text-align:center;box-sizing:border-box}
.bm-welcome-hero:before{content:"";position:absolute;inset:0;z-index:-1;opacity:.23;pointer-events:none;
 background-image:radial-gradient(#b8e9ff 1px,transparent 1px);background-size:28px 28px}
.bm-welcome-close{position:sticky;float:right;top:0;right:0;z-index:3;border:1px solid #cab5ff66;background:#ffffff21;color:#fff;
 font-size:1.5rem;border-radius:50%;width:44px;height:44px;cursor:pointer;display:grid;place-items:center}
.bm-welcome-close:focus-visible{outline:3px solid #9bffdc}
.bm-welcome-center{position:relative;z-index:2;max-width:680px;margin:16px auto 0;display:grid;place-items:center;gap:10px}
.bm-welcome-mark{height:92px;display:grid;place-items:center}.bm-welcome-mark img{width:min(340px,55vw);height:95px;object-fit:contain;filter:drop-shadow(0 0 14px #a38eff77)}
.bm-welcome-mark b{font-size:3rem;background:linear-gradient(90deg,#f7edff,#76daff,#ec65ff);background-clip:text;color:transparent}
.bm-welcome-overline{font-weight:900;font-size:.72rem;letter-spacing:.19em;color:#80dfea;margin:0}
.bm-welcome-center h2{font-size:clamp(2rem,5.2vw,4rem);line-height:1.09;letter-spacing:-.045em;margin:7px 0 0;font-weight:1000;text-shadow:0 5px 15px #080a4466}
.bm-welcome-center h2 em{font-style:normal;color:#f27ced}.bm-welcome-center h2 span{color:#61e3fa}
.bm-welcome-sub{font-size:clamp(.95rem,1.6vw,1.15rem);max-width:44ch;line-height:1.53;color:#d4d1ff;margin:3px auto 14px}
.bm-welcome-buttons{display:flex;justify-content:center;align-items:center;gap:13px;flex-wrap:wrap}
.bm-welcome-buttons a{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:49px;min-width:150px;padding:12px 20px;
 text-decoration:none;color:#fff;border-radius:999px;font-weight:850;border:1px solid #bdb6ff}
.bm-welcome-join{background:linear-gradient(110deg,#248af9,#8f4dfe 55%,#f24cce);box-shadow:0 0 18px #bc66ff66}
.bm-welcome-explore{background:#ffffff15;backdrop-filter:blur(8px)}
.bm-welcome-cards{position:absolute;z-index:1;display:grid;gap:8px;align-items:center;justify-items:center;top:98px;width:150px;
 border:1px solid #b38cffbe;background:linear-gradient(155deg,#6956d884,#1d3fa166);border-radius:23px;padding:12px 8px;transform:rotate(-9deg);box-shadow:0 7px 30px #0e053fa8}
.bm-welcome-cards img{width:88px;height:88px;border-radius:50%;box-shadow:0 0 0 4px #ffffff39}
.bm-welcome-cards span{display:flex;gap:5px;align-items:center;color:#ff91bd;font-size:1.1rem}
.bm-welcome-cards small{color:#fff;font-size:.72rem;text-align:left;font-weight:750;line-height:1.25}
.bm-welcome-left{left:26px}.bm-welcome-right{right:24px;transform:rotate(8deg)}
.bm-welcome-orb{position:absolute;width:260px;height:260px;pointer-events:none;border-radius:50%;z-index:-1;
 filter:blur(25px);background:#9c49e83b}.bm-orb-one{left:-8%;bottom:-12%}.bm-orb-two{right:-10%;top:-13%;background:#1a74f64e}
.bm-welcome-skyline{position:relative;margin:36px -22px -7px;height:106px;
 background:linear-gradient(0deg,#020927cf,transparent),linear-gradient(180deg,transparent,#764ada33);
 overflow:hidden}.bm-buildings{position:absolute;left:0;right:0;bottom:0;height:77px;opacity:.67;
 background:repeating-linear-gradient(90deg,#090a3b 0,#090a3b 19px,transparent 19px,transparent 26px),
 linear-gradient(135deg,transparent,#ed5ac94e);clip-path:polygon(0 50%,7% 50%,7% 20%,12% 20%,12% 75%,18% 75%,18% 6%,24% 6%,24% 62%,30% 62%,30% 10%,35% 10%,35% 74%,42% 74%,42% 25%,48% 25%,48% 52%,56% 52%,56% 4%,64% 4%,64% 53%,71% 53%,71% 28%,80% 28%,80% 60%,89% 60%,89% 13%,100% 13%,100% 100%,0 100%)}
.bm-welcome-features{display:flex;justify-content:space-around;gap:11px;flex-wrap:wrap;position:relative;z-index:2;margin-top:-18px}
.bm-welcome-features>span{display:grid;justify-items:center;gap:3px;font-size:1.7rem;text-shadow:0 0 14px #d380ff}
.bm-welcome-features small{font-size:.74rem;font-weight:700;color:#dfe2ff;text-shadow:none}
@media(max-width:730px){.bm-welcome-hero{min-height:0;padding:14px 12px 17px;border-radius:20px}
 .bm-welcome-center{margin-top:3px}.bm-welcome-mark{height:64px}.bm-welcome-mark img{height:65px}
 .bm-welcome-cards{top:100px;width:74px;padding:5px;border-radius:12px}
 .bm-welcome-cards img{width:48px;height:48px}.bm-welcome-cards span{font-size:.7rem}.bm-welcome-cards small{display:none}
 .bm-welcome-left{left:7px}.bm-welcome-right{right:7px}
 .bm-welcome-center h2{font-size:clamp(1.6rem,5vw,2.5rem);max-width:24ch}
 .bm-welcome-sub{max-width:31ch}.bm-welcome-skyline{margin:10px -12px -5px;height:55px}
 .bm-welcome-features{margin-top:0}.bm-welcome-features small{font-size:.62rem}
 .bm-welcome-buttons a{min-width:128px;min-height:44px}
}
@media(max-width:430px){.bm-welcome-cards{display:none}.bm-welcome-hero{max-height:calc(100dvh - 18px)}.bm-welcome-center h2{font-size:1.9rem}}
@media(prefers-reduced-motion:reduce){.bm-welcome-hero,.bm-welcome-backdrop{scroll-behavior:auto}}
`;
document.head.appendChild(style);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",()=>setTimeout(build,1800),{once:true});else setTimeout(build,1800);
