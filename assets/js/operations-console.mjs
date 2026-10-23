import {getSession} from "./supabase.js";

/* A lightweight owner dashboard with no polling and no third-party analytics.
 * Every element is created via textContent, never server-controlled innerHTML. */
const QUEUES=[
  {key:"verification",title:"Verification applications",detail:"Applications waiting for evidence review",tab:"verification",action:"Review verification"},
  {key:"reports",title:"User & content reports",detail:"Open account and content complaints",url:"../moderator/dashboard.html?tab=reports",action:"Review reports"},
  {key:"spaceReports",title:"Live Space reports",detail:"Reports against voice rooms requiring review",url:"../admin/spaces-reports.html",action:"Review Space reports"},
  {key:"communityReports",title:"Community reports",detail:"Open board-specific complaints",url:"../discussion.html",action:"Open communities"},
  {key:"autoModeration",title:"Auto-moderation queue",detail:"Flagged forum submissions requiring review",url:"../discussion.html",action:"Open communities"},
  {key:"scheduledPosts",title:"Scheduled articles",detail:"Editorial posts queued for publication",tab:"posts",action:"Manage posts"},
  {key:"overduePosts",title:"Overdue articles",detail:"Publication time passed but the post is still waiting",tab:"posts",action:"Investigate posts"}
];
const JOB_LABELS={
  "automation-maintenance":"Publishing, notifications & expiry",
  "curator-scout":"Curator source discovery",
  "verification-maintenance":"Verified identity expiry & renewals",
  "scheduled-articles":"Scheduled article publishing"
};
const $=id=>document.getElementById(id);
const elt=(name,className="",text="")=>{
  const node=document.createElement(name);
  if(className)node.className=className;
  if(text)node.textContent=text;
  return node;
};
const formatTime=value=>{
  if(!value)return "No successful run recorded";
  const date=new Date(value);
  return Number.isFinite(date.getTime())?date.toLocaleString():"Unknown time";
};

function renderQueues(data){
  const target=$("operationsQueues");
  if(!target)return;
  target.replaceChildren();
  for(const item of QUEUES){
    const value=data?.[item.key];
    const card=elt("article","operations-tile");
    const head=elt("div","operations-tile-heading");
    const heading=elt("h4","",item.title);
    const num=elt("span","operations-count",
      Number.isInteger(value)?value.toLocaleString():"Unavailable");
    num.dataset.tone=value===null||value===undefined?"unknown":
      value>0&&item.key!=="scheduledPosts"?"attention":"neutral";
    head.append(heading,num);
    card.append(head,elt("p","operations-description",item.detail));
    const action=item.tab?elt("button","btn ghost sm",item.action):
      elt("a","btn ghost sm",item.action);
    if(item.tab){
      action.type="button";
      action.addEventListener("click",()=>{
        const tab=document.querySelector('.admin-nav button[data-tab="'+item.tab+'"]');
        tab?.click();
      });
    } else {
      action.href=item.url;
    }
    card.append(action);
    target.append(card);
  }
}

function renderJobs(jobs){
  const host=$("operationsJobs");
  if(!host)return;
  host.replaceChildren();
  for(const job of jobs||[]){
    const row=elt("li","operations-job");
    const main=elt("div","operations-job-copy");
    main.append(
      elt("strong","",JOB_LABELS[job.name]||"Background automation"),
      elt("small","",formatTime(job.lastSuccess))
    );
    const status=elt("span","operations-job-state",job.state||"unknown");
    status.dataset.tone=job.state||"unknown";
    row.append(main,status);host.append(row);
  }
  if(!jobs?.length)host.append(elt("li","operations-job","No job status available."));
}

function renderAudit(events){
  const host=$("operationsAudit");
  if(!host)return;
  host.replaceChildren();
  if(events===null){
    host.append(elt("li","operations-audit-item","Audit history unavailable."));
    return;
  }
  if(!events?.length){
    host.append(elt("li","operations-audit-item","No recent moderation actions."));
    return;
  }
  for(const event of events){
    const item=elt("li","operations-audit-item");
    item.append(elt("strong","",String(event.action||"Moderation action").replaceAll("_"," ")));
    item.append(elt("span","",String(event.content_type||"content")));
    item.append(elt("time","",formatTime(event.created_at)));
    host.append(item);
  }
}

let loading=false;
async function loadOverview(){
  if(loading)return;
  loading=true;
  const status=$("operationsStatus"),refresh=$("operationsRefresh");
  if(refresh)refresh.disabled=true;
  if(status){status.textContent="Checking platform operations…";status.dataset.tone="neutral";}
  try{
    const session=await getSession();
    if(!session?.access_token)throw Error("Your session has expired. Sign in again.");
    const response=await fetch("/.netlify/functions/operations-overview",{
      method:"GET",headers:{Authorization:"Bearer "+session.access_token},cache:"no-store"
    });
    let payload;
    try{payload=await response.json();}catch{throw Error("The server returned an invalid operations response.");}
    if(!response.ok)throw Error(payload?.error||"Could not load operations.");
    renderQueues(payload.queues);
    renderJobs(payload.jobs);
    renderAudit(payload.audit);
    const issues=Array.isArray(payload.issues)?payload.issues:[];
    if(status){
      status.dataset.tone=issues.length?"warning":"success";
      status.textContent=(issues.length?
        issues.length+" item(s) need attention. ":"No service alerts in the available data. ")+
        "Checked "+formatTime(payload.checkedAt)+".";
    }
    const details=$("operationsIssues");
    if(details){
      details.replaceChildren();
      for(const issue of issues.slice(0,12))
        details.append(elt("li","",String(issue)));
      if(!issues.length)details.append(elt("li","","No active service alerts detected."));
    }
    const note=$("operationsNote");
    if(note)note.textContent=payload.note||"Status is read-only and may lag behind live traffic.";
  }catch(error){
    if(status){status.textContent=error.message||"Operations cannot be loaded.";status.dataset.tone="error";}
    $("operationsQueues")?.replaceChildren();
    $("operationsJobs")?.replaceChildren();
    $("operationsAudit")?.replaceChildren();
    $("operationsIssues")?.replaceChildren();
  }finally{
    loading=false;
    if(refresh)refresh.disabled=false;
  }
}
export function mountOperationsConsole(){
  const tab=document.querySelector('.admin-nav button[data-tab="operations"]');
  if(!tab||!$("operationsQueues"))return;
  tab.addEventListener("click",()=>void loadOverview());
  $("operationsRefresh")?.addEventListener("click",()=>void loadOverview());
}
