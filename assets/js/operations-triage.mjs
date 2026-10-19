import {getSession,supabase} from "./supabase.js";

/* Zero polling: staff explicitly opens/refeshes a bounded inbox. Reviews
   always use existing server-side moderation policies; no direct table writes. */
const $=id=>document.getElementById(id);
const LABELS=Object.freeze({
  reports:"Site reports",community:"Community reports",automod:"Spam signals"
});
const ACTIONS=Object.freeze({
  reports:[["resolve","Resolve report"],["dismiss","Dismiss report"]],
  community:[["reviewed","Mark reviewed"],["dismissed","Dismiss report"]],
  automod:[["reviewed","Acknowledge signal"],["dismissed","Dismiss signal"]]
});
const make=(tag,className="",text="")=>{
  const el=document.createElement(tag);
  if(className)el.className=className;
  el.textContent=text;
  return el;
};
const state={kind:"reports",page:1,busy:false,serial:0,controller:null,requestKeys:new Map()};
const fmt=value=>{
  const d=new Date(value||"");
  return Number.isFinite(d.getTime())?d.toLocaleString():"Unknown time";
};
function message(value,tone="neutral"){
  const host=$("operationsTriageStatus");
  if(host){host.textContent=value;host.dataset.tone=tone;}
}
function setBusy(value){
  state.busy=value;
  $("operationsTriageRefresh")?.toggleAttribute("disabled",value);
  $("operationsTriagePrev")?.toggleAttribute("disabled",value);
  $("operationsTriageNext")?.toggleAttribute("disabled",value);
  if($("operationsTriageKind"))$("operationsTriageKind").disabled=value;
  $("operationsTriageList")?.querySelectorAll("button[data-triage-action]")
    .forEach(button=>{button.disabled=value;});
}
function render(payload){
  const host=$("operationsTriageList");
  if(!host)return;
  host.replaceChildren();
  for(const item of payload.items||[]){
    const article=make("article","operations-triage-item");
    const heading=make("div","operations-triage-heading");
    heading.append(make("strong","",LABELS[item.kind]||"Moderation"));
    const age=make("time","",fmt(item.createdAt));
    if(item.createdAt)age.dateTime=item.createdAt;
    heading.append(age);
    article.append(heading);
    article.append(make("p","operations-triage-target",
      (item.targetType||"content")+" · "+(item.targetId||"No target ID")));
    if(item.kind==="automod"){
      const risk=Number(item.riskScore)||0;
      const label=make("strong","operations-triage-risk",
        risk>=70?"High-risk signal · "+risk+"/100":"Automated signal · "+risk+"/100");
      label.dataset.level=risk>=70?"high":risk>=40?"medium":"normal";
      article.append(label);
      article.append(make("p","operations-triage-reason",
        Array.isArray(item.signals)?item.signals.join(", ").replaceAll("_"," "):"No signals supplied"));
    }else{
      article.append(make("p","operations-triage-reason",item.reason||"No reason supplied"));
    }
    const actions=make("div","operations-triage-actions");
    for(const [action,label] of ACTIONS[item.kind]||[]){
      const btn=make("button","btn ghost sm",label);
      btn.type="button";
      btn.dataset.triageKind=item.kind;
      btn.dataset.triageAction=action;
      btn.dataset.triageId=String(item.id);
      actions.append(btn);
    }
    article.append(actions);
    host.append(article);
  }
  if(!payload.items?.length)host.append(make("p","operations-note","Nothing awaiting review in this queue."));
  const pageLabel=$("operationsTriagePage");
  if(pageLabel)pageLabel.textContent="Page "+payload.page+(Number.isInteger(payload.total)?" · "+payload.total+" waiting":"");
  if($("operationsTriagePrev"))$("operationsTriagePrev").disabled=payload.page<=1;
  if($("operationsTriageNext"))$("operationsTriageNext").disabled=!payload.hasMore;
}
async function sessionToken(){
  const session=await getSession();
  if(!session?.access_token)throw Error("Your staff session expired. Sign in again.");
  return session.access_token;
}
async function load(){
  if(state.busy)return;
  const serial=++state.serial;
  state.controller?.abort();
  const controller=new AbortController();
  state.controller=controller;
  message("Loading "+LABELS[state.kind].toLowerCase()+"…");
  try{
    const token=await sessionToken();
    if(serial!==state.serial)return;
    const url="/.netlify/functions/operations-inbox?kind="+
      encodeURIComponent(state.kind)+"&page="+state.page;
    const response=await fetch(url,{headers:{Authorization:"Bearer "+token},
      cache:"no-store",signal:controller.signal});
    const payload=await response.json().catch(()=>null);
    if(!response.ok)throw Error(payload?.error||"Moderation inbox unavailable.");
    if(!payload||!Array.isArray(payload.items))throw Error("Invalid moderation inbox response.");
    if(serial!==state.serial)return;
    render(payload);
    message("Review actions record a decision; they do not automatically delete or ban content.","neutral");
  }catch(error){
    if(error.name==="AbortError"||serial!==state.serial)return;
    $("operationsTriageList")?.replaceChildren();
    message(error.message||"Cannot load moderation queue.","error");
  }
}
async function takeAction(button){
  if(state.busy)return;
  const kind=button.dataset.triageKind,action=button.dataset.triageAction,id=button.dataset.triageId;
  if(!Object.hasOwn(ACTIONS,kind)||!ACTIONS[kind].some(pair=>pair[0]===action)||
     !/^(?:[a-f0-9-]{36}|[1-9]\d*)$/i.test(String(id)))return;
  const label=ACTIONS[kind].find(pair=>pair[0]===action)[1].toLowerCase();
  if(!window.confirm("Are you sure you want to "+label+"? This records your review, not an automatic content ban."))return;
  setBusy(true);
  message("Saving your review…");
  try{
    if(kind==="reports"){
      const token=await sessionToken();
      const key=kind+":"+id+":"+action;
      if(!state.requestKeys.has(key))state.requestKeys.set(key,crypto.randomUUID());
      const response=await fetch("/.netlify/functions/moderate-content",{
        method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},
        body:JSON.stringify({type:"content_reports",id,
          action,requestId:state.requestKeys.get(key)})
      });
      const payload=await response.json().catch(()=>null);
      if(!response.ok||!payload?.auditRecorded)
        throw Error(payload?.error||"Could not confirm the audited report decision.");
      state.requestKeys.delete(key);
    }else{
      const params=kind==="community"
        ?{p_report:id,p_resolution:action}
        :{p_id:Number(id),p_resolution:action};
      const {error}=await supabase.rpc(kind==="community"
        ?"community_review_report":"community_review_auto_flag",params);
      if(error)throw Error("The review was not saved. "+(error.message||"Please retry."));
    }
    message("Review saved. Reloading the queue…","success");
  }catch(error){
    message(error.message||"Review failed. The item remains in your queue.","error");
    setBusy(false);
    return;
  }
  setBusy(false);
  await load();
}
export function mountOperationsTriage(){
  const tab=document.querySelector('.admin-nav button[data-tab="operations"]');
  if(!tab||!$("operationsTriageList"))return;
  tab.addEventListener("click",()=>void load());
  $("operationsTriageRefresh")?.addEventListener("click",()=>void load());
  $("operationsTriageKind")?.addEventListener("change",event=>{
    const next=event.target.value;
    if(!Object.hasOwn(LABELS,next)||state.busy)return;
    state.kind=next;state.page=1;void load();
  });
  $("operationsTriagePrev")?.addEventListener("click",()=>{
    if(state.busy||state.page<=1)return;
    state.page--;void load();
  });
  $("operationsTriageNext")?.addEventListener("click",()=>{
    if(state.busy)return;
    state.page=Math.min(50,state.page+1);void load();
  });
  $("operationsTriageList").addEventListener("click",event=>{
    const button=event.target.closest("button[data-triage-action]");
    if(button&&$("operationsTriageList").contains(button))void takeAction(button);
  });
}
