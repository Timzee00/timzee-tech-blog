import {supabase,getCurrentUser} from "./supabase.js";
import {remainingLaunchTime,featureStatusLabel,launchFeaturePath} from "./launch-clock.mjs";
import "./nav.js";

const $=id=>document.getElementById(id);
const make=(tag,cls,text)=>{
  const e=document.createElement(tag);
  if(cls)e.className=cls;
  if(text!==undefined)e.textContent=String(text);
  return e;
};
const state={user:null,features:[],subscribed:new Set(),busy:new Set(),ticker:null};
function setStatus(text,tone="neutral"){
  const el=$("launchesStatus");
  if(!el)return;
  el.textContent=text;el.dataset.tone=tone;
}
function launchClockNode(feature){
  const wrapper=make("div","launch-card-clock");
  if(feature.status==="live"){
    wrapper.append(make("span","launch-clock-label","Available now"));
    return wrapper;
  }
  if(feature.status==="paused"){
    wrapper.append(make("span","launch-clock-label","The launch is currently on hold"));
    return wrapper;
  }
  wrapper.append(make("span","launch-clock-label","COUNTDOWN TO TARGET DATE"));
  const timer=make("strong","launch-timer");
  timer.dataset.launchAt=feature.launch_at||"";
  timer.setAttribute("role","timer");
  timer.setAttribute("aria-live","off");
  timer.textContent=remainingLaunchTime(feature.launch_at).label;
  wrapper.append(timer);
  return wrapper;
}
function updateTimers(){
  document.querySelectorAll(".launch-timer").forEach(el=>{
    const next=remainingLaunchTime(el.dataset.launchAt).label;
    if(el.textContent!==next)el.textContent=next;
  });
}
function card(feature){
  const box=make("article","launch-card");
  box.dataset.launchStatus=feature.status;
  box.id="launch-"+feature.slug;
  const top=make("div","launch-card-top");
  const status=make("span","launch-status-pill",featureStatusLabel(feature.status));
  top.append(status);
  if(feature.launch_at){
    const date=new Date(feature.launch_at);
    const formatted=Number.isFinite(date.getTime())?
      date.toLocaleString(undefined,{dateStyle:"medium",timeStyle:"short"}):"";
    if(formatted)top.append(make("span","launch-card-date","Target: "+formatted));
  }
  box.append(top,make("h2","launch-card-title",feature.title),
    make("p","launch-card-description",feature.description||"Something new is on its way."),
    launchClockNode(feature));

  const controls=make("div","launch-card-actions");
  const destination=launchFeaturePath(feature);
  if(feature.status==="live"&&destination){
    const visit=make("a","btn launch-open","Explore feature →");
    visit.href=destination;controls.append(visit);
  }
  if(feature.status!=="live"&&(feature.notify_enabled||state.subscribed.has(feature.id))){
    const subscribing=state.subscribed.has(feature.id);
    const button=make("button","btn "+(subscribing?"ghost":"")+" launch-subscribe",
      state.user?(subscribing?"✓ Reminder enabled":"🔔 Remind me when live"):"Sign in for a reminder");
    if(!feature.notify_enabled&&!subscribing)button.disabled=true;
    button.type="button";button.dataset.launchId=feature.id;
    button.disabled=state.busy.has(feature.id);
    button.setAttribute("aria-pressed",String(subscribing));
    button.addEventListener("click",()=>{
      if(!state.user){window.location.href="/login.html";return;}
      void toggleSubscription(feature);
    });
    controls.append(button);
  }
  box.append(controls);
  return box;
}
function render(){
  const grid=$("launchesGrid");if(!grid)return;
  grid.replaceChildren();
  const rows=[...state.features].sort((a,b)=>{
    const rank={coming_soon:0,in_progress:1,paused:2,live:3};
    const score=(rank[a.status]??4)-(rank[b.status]??4);
    return score||(a.launch_at||"9999").localeCompare(b.launch_at||"9999");
  });
  const count=rows.filter(r=>r.status!=="live").length;
  $("launchesCount").textContent=count?count+" features on the roadmap":"New releases are coming";
  if(!rows.length){
    grid.append(make("p","launch-empty","No public launch announcements yet. Check back for what's next."));
    return;
  }
  for(const feature of rows)grid.append(card(feature));
  const requested=new URLSearchParams(window.location.search).get("feature");
  if(requested&&/^[a-z0-9-]{1,64}$/.test(requested)){
    const target=document.getElementById("launch-"+requested);
    if(target)target.scrollIntoView({block:"center",behavior:"instant"});
  }
}
async function toggleSubscription(feature){
  if(state.busy.has(feature.id)||!state.user)return;
  state.busy.add(feature.id);
  const isSubscribed=state.subscribed.has(feature.id);
  render();
  try{
    const q=supabase.from("feature_launch_subscriptions");
    const result=isSubscribed?
      await q.delete().eq("user_id",state.user.id).eq("launch_id",feature.id):
      await q.insert({launch_id:feature.id,user_id:state.user.id});
    if(result.error)throw result.error;
    if(isSubscribed)state.subscribed.delete(feature.id);
    else state.subscribed.add(feature.id);
    setStatus(isSubscribed?"Launch reminder cancelled.":"Reminder saved. You'll receive an in-app notification when this feature launches.","success");
  }catch(error){
    setStatus("Couldn't update the reminder. Please try again.", "error");
    console.warn("Launch reminder update failed",error?.code||"unavailable");
  }finally{state.busy.delete(feature.id);render();}
}
async function init(){
  setStatus("Loading our upcoming releases…");
  const result=await supabase.from("feature_launches")
    .select("id,slug,title,description,status,target_path,launch_at,notify_enabled")
    .eq("is_public",true).order("created_at",{ascending:false}).limit(80);
  if(result.error)throw result.error;
  state.features=result.data||[];
  state.user=await getCurrentUser().catch(()=>null);
  if(state.user&&state.features.length){
    const ids=state.features.map(item=>item.id);
    const saved=await supabase.from("feature_launch_subscriptions")
      .select("launch_id").eq("user_id",state.user.id).in("launch_id",ids).limit(80);
    if(!saved.error)state.subscribed=new Set((saved.data||[]).map(item=>item.launch_id));
    else console.warn("Launch subscriptions unavailable",saved.error?.code||"unknown");
  }
  setStatus(state.user?"Choose any upcoming feature to follow.":"Sign in to receive personal launch reminders.");
  render();
  state.ticker=window.setInterval(()=>{
    if(!document.hidden)updateTimers();
  },1000);
  document.addEventListener("visibilitychange",()=>{if(!document.hidden)updateTimers()});
  window.addEventListener("pagehide",()=>window.clearInterval(state.ticker),{once:true});
}
init().catch(error=>{
  console.warn("Launch board unavailable",error?.code||error?.message||"unknown");
  setStatus("Launch updates are temporarily unavailable. Please refresh to try again.","error");
});