// One information architecture for the desktop rail and mobile menu.
const GROUPS=[
 {label:"Discover",links:[
  ["⌂","Home","/index.html"],["✧","For You","/fyp.html"],["▷","Reels","/video.html"],
  ["◉","Live Spaces","/spaces.html"],["▦","Communities","/discussion.html"],
  ["◈","Marketplace","/marketplace.html"]]},
 {label:"Connect",links:[
  ["◇","Messages","/chat.html"],["◌","Status","/stories.html"],
  ["♧","My Profile","/profile.html"],["♢","Notifications","/profile.html?tab=notifications"]]},
 {label:"Your space",links:[
  ["⚙","Settings","/settings.html"],["?","Help & Support","/support.html"],
  ["★","Leaderboard","/index.html#leaderboardList"]]}
];
const current=location.pathname.split("/").pop()||"index.html";
const safeSkip=new Set(["login.html","welcome.html","video.html","404.html"]);
function active(path){
 const target=new URL(path,location.origin);
 return current===(target.pathname.split("/").pop()||"index.html") &&
    (!target.search||location.search===target.search);
}
function makeLinks(){
 return GROUPS.map(group=>'<div class="bm-rail-group"><h3>'+group.label+'</h3>'+
 group.links.map(([symbol,label,href])=>'<a href="'+href+'" class="bm-rail-link'+
 (active(href)?' is-active':'')+'"'+(active(href)?' aria-current="page"':'')+
 '><span class="bm-rail-icon" aria-hidden="true">'+symbol+'</span><span>'+label+'</span></a>').join("")+
 '</div>').join("");
}
function install(){
 if(safeSkip.has(current)||location.pathname.startsWith("/admin/")||
  location.pathname.startsWith("/super/")||location.pathname.startsWith("/moderator/")||
  location.pathname.startsWith("/author/"))return;
 if(document.getElementById("bmUnifiedRail"))return;
 const rail=document.createElement("aside");
 rail.id="bmUnifiedRail";rail.className="bm-unified-rail";
 rail.innerHTML='<a class="bm-rail-brand" href="/index.html" aria-label="Blipmood home"><img data-bm-logo="wordmark" src="https://d2ol7oe51mr4n9.cloudfront.net/user_3JR5g6OD2PPsWciJ9XxM8Ue05wO/1edfccf6-fdc1-409c-b9c5-162b23657600.png" width="190" height="63" alt="" decoding="async"></a>'+
  '<nav aria-label="Explore Blipmood">'+makeLinks()+'</nav>'+
  '<div class="bm-rail-bottom"><span>Made for real communities.</span></div>';
 document.body.prepend(rail);
 document.body.classList.add("bm-has-unified-rail");
 const menu=document.getElementById("siteMenu");
 if(menu&&!menu.querySelector(".bm-drawer-navigation")){
  const wrapper=document.createElement("nav");
  wrapper.className="bm-drawer-navigation";wrapper.setAttribute("aria-label","Blipmood menu");
  wrapper.innerHTML=makeLinks();
  const original=menu.querySelector(".nav-pill");
  menu.insertBefore(wrapper,original||menu.querySelector(".site-menu-footer")||null);
 }
}
const css=document.createElement("style");css.id="bm-unified-navigation-styles";
css.textContent=`
.bm-unified-rail{position:fixed;top:0;left:0;bottom:0;width:232px;z-index:75;box-sizing:border-box;
 background:linear-gradient(170deg,#090e25,#12132a 62%,#071d29);border-right:1px solid #7886d02c;
 padding:18px 14px;display:none;flex-direction:column;min-height:0;color:#d5dbfa}
.bm-unified-rail nav{min-height:0;overflow-y:auto;overflow-x:hidden;padding-right:3px;scrollbar-width:thin}
.bm-rail-brand{display:flex;justify-content:center;align-items:center;height:68px;min-height:68px;padding:2px 6px 13px;text-decoration:none;box-sizing:border-box}
.bm-rail-brand img{width:100%;max-width:194px;height:auto;max-height:64px;object-fit:contain}
.bm-rail-brand:focus-visible{outline:3px solid #71e5f1;outline-offset:2px;border-radius:9px}
.bm-rail-group{margin:4px 0 15px}.bm-rail-group h3{font-size:.7rem;letter-spacing:.12em;text-transform:uppercase;
 color:#9a9fc9;font-weight:850;margin:8px 11px}
.bm-rail-link{display:flex;align-items:center;gap:10px;min-height:43px;border-radius:12px;padding:9px 13px;
 font-size:.86rem;font-weight:700;color:inherit;text-decoration:none;box-sizing:border-box}
.bm-rail-link:hover,.bm-rail-link:focus-visible{background:#6758dc29;color:white}
.bm-rail-link.is-active{color:#e2cdff;background:linear-gradient(90deg,#805ce438,#4b60e819)}
.bm-rail-icon{width:23px;font-size:1.22rem;display:inline-flex;justify-content:center;font-weight:700}
.bm-rail-bottom{font-size:.69rem;color:#7da3ba;padding:13px;border-top:1px solid #ffffff1d}
.bm-drawer-navigation{display:grid;gap:5px;padding:12px 9px;min-width:0;max-width:100%;overflow-y:auto}
.bm-drawer-navigation .bm-rail-group{margin:0 0 7px}.bm-drawer-navigation .bm-rail-group h3{margin:12px 10px 5px}
.bm-drawer-navigation .bm-rail-link{font-size:.89rem;min-height:44px;color:var(--color-text,#fff)}
.bm-drawer-navigation .bm-rail-link.is-active{background:#416cbd24;color:var(--color-primary,#65d8bd)}
.site-menu .bm-drawer-navigation ~ .nav-pill{display:none!important}
@media(min-width:1190px){
 .bm-has-unified-rail{padding-left:232px}
 .bm-unified-rail{display:flex}
 .bm-has-unified-rail .site-header{width:100%;max-width:100%}
 .bm-has-unified-rail .site-header .brand{display:none!important}
 .bm-has-unified-rail .site-header .nav-pill{display:none!important}
 .bm-has-unified-rail .site-header .wrap{gap:12px}
 .bm-has-unified-rail .site-header .site-menu{max-width:100%}
 .bm-has-unified-rail .bm-drawer-navigation{display:none}
}
@media(max-width:1189px){.bm-unified-rail{display:none!important}.bm-has-unified-rail{padding-left:0}}
@media(max-width:960px){.bm-drawer-navigation{max-height:calc(100dvh - 200px);overflow:auto}}
@media(prefers-reduced-motion:reduce){.bm-rail-link{scroll-behavior:auto}}
`;
document.head.appendChild(css);
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",install,{once:true});else install();
