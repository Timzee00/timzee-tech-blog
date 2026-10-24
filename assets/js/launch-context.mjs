/* Optional, non-blocking launch notices on admin-selected public pages and sections.
   These labels are informational, never a substitute for server authorization. */
import {supabase} from "./supabase.js";
import {remainingLaunchTime,featureStatusLabel} from "./launch-clock.mjs";
function pagePath(){
  const path=window.location.pathname||"/";
  const normalized=path==="/"?"/index.html":path;
  return /^\/[a-zA-Z0-9/_-]+\.html$/.test(normalized)&&!normalized.includes("..")?normalized:null;
}
const make=(tag,cls,text)=>{
  const n=document.createElement(tag);if(cls)n.className=cls;
  if(text!==undefined)n.textContent=String(text);
  return n;
};
async function showLaunchNotices(){
  const path=pagePath();
  const main=document.querySelector("main");
  if(!path||!main||path==="/launches.html")return;
  const response=await supabase.from("feature_launches")
    .select("slug,title,status,target_path,launch_at")
    .eq("is_public",true)
    .like("target_path",path+"%")
    .neq("status","live").limit(20);
  if(response.error){console.warn("Feature status lookup unavailable",response.error.code||"network");return;}
  let timers=[];
  for(const row of response.data||[]){
    if(row.target_path!==path&&!row.target_path?.startsWith(path+"#"))continue;
    const hash=row.target_path?.split("#")[1];
    const section=hash?document.getElementById(hash):null;
    if(hash&&!section)continue;
    const banner=make("aside","launch-context"+(section?" launch-context--section":""));
    banner.setAttribute("aria-label",row.title+" launch status");
    const info=make("div","launch-context-copy");
    info.append(make("strong",row.title+" · "+featureStatusLabel(row.status)));
    const status=make("span");
    status.textContent=row.status==="paused"?"Temporarily on hold":
      row.launch_at?remainingLaunchTime(row.launch_at).label:"Launch date to be announced";
    if(row.launch_at&&row.status!=="paused"){
      status.dataset.launchAt=row.launch_at;timers.push(status);
    }
    info.append(status);
    const link=make("a","","See what's next →");
    link.href="/launches.html?feature="+encodeURIComponent(row.slug);
    banner.append(info,link);
    if(section&&main.contains(section))section.before(banner);
    else main.prepend(banner);
  }
  if(timers.length){
    const interval=window.setInterval(()=>{
      if(document.hidden)return;
      for(const el of timers)el.textContent=remainingLaunchTime(el.dataset.launchAt).label;
    },1000);
    window.addEventListener("pagehide",()=>window.clearInterval(interval),{once:true});
  }
}
void showLaunchNotices().catch(error=>console.warn("Launch notices unavailable",error?.code||"unknown"));
