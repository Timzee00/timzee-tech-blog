import {getSession} from "./supabase.js";
const $=id=>document.getElementById(id);
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const state={reports:[],total:0,page:0,busy:false};
const el=(tag,text,className)=>{
 const node=document.createElement(tag);
 if(text!==undefined)node.textContent=String(text||"");
 if(className)node.className=className;
 return node;
};
const date=value=>value&&Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():"Date unavailable";
const human=value=>String(value||"Unspecified").replaceAll("_"," ");
const statusText=value=>value==="resolved"?"Violation confirmed":value==="dismissed"?"Dismissed":value==="open"?"Needs review":human(value);
async function api(options={}){
 const session=await getSession();
 if(!session?.access_token)throw Error("Sign in again with your moderator account.");
 const query=new URLSearchParams();
 if(options.id)query.set("id",options.id);
 if(options.status)query.set("status",options.status);
 if(options.page!==undefined)query.set("page",String(options.page));
 const response=await fetch("/.netlify/functions/moderation-cases"+(query.size?"?"+query:""),{
  method:options.body?"POST":"GET",cache:"no-store",
  headers:{Authorization:"Bearer "+session.access_token,...(options.body?{"Content-Type":"application/json"}:{})},
  ...(options.body?{body:JSON.stringify(options.body)}:{})
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||"Moderation service is unavailable.");
 return result;
}
const label=(container,title,value)=>{
 const section=el("div",undefined,"moderation-detail-line");
 section.append(el("strong",title),el("p",value||"Unavailable"));
 container.append(section);return section;
};
function renderList(){
 const host=$("modReports");if(!host)return;
 host.replaceChildren();
 const search=($("modReportSearch")?.value||"").trim().toLowerCase();
 const filtered=state.reports.filter(r=>!search||[r.id,r.content_type,r.reason,r.content_id].some(x=>String(x||"").toLowerCase().includes(search)));
 if(!filtered.length)host.append(el("p","No reports match this filter.","moderation-muted"));
 for(const report of filtered){
  const card=el("article",undefined,"moderation-report-card");
  const top=el("div",undefined,"moderation-report-top");
  top.append(el("strong",human(report.content_type)));
  top.append(el("span",report.status==="open"&&report.investigation_state==="investigating"?"Under investigation":statusText(report.status),"moderation-status"));
  card.append(top,el("p",report.reason||"No reason provided"),el("small",date(report.created_at)));
  const button=el("button",report.status==="open"?"Investigate report":"View decision","btn ghost");
  button.type="button";
  button.addEventListener("click",()=>void openReportCase(report.id));
  card.append(button);host.append(card);
 }
 if($("modReportCount"))$("modReportCount").textContent=state.total+" reports in this status · "+filtered.length+" shown on this page (page "+(state.page+1)+").";
 if($("modReportsPrev"))$("modReportsPrev").disabled=state.busy||state.page===0;
 if($("modReportsNext"))$("modReportsNext").disabled=state.busy||(state.page+1)*40>=state.total;
}
export async function loadReportQueue(){
 const status=$("modReportFilter")?.value||"open";
 state.busy=true;
 if($("modReportCount"))$("modReportCount").textContent="Loading reports…";
 try{
  const result=await api({status,page:state.page});
  state.reports=result.reports||[];state.total=Number(result.total||0);
  renderList();
 }catch(error){
  if($("modReports"))$("modReports").replaceChildren(el("p",error.message));
 }finally{state.busy=false;renderList();}
}
function inputControl(form,title,name,tag="textarea"){
 const wrap=el("label",title);
 const field=document.createElement(tag);
 field.name=name;field.required=true;
 if(tag==="textarea"){field.rows=4;field.minLength=20;field.maxLength=2000;}
 wrap.append(field);form.append(wrap);
 return field;
}
function investigationForm(host,record,caseData){
 if(record.status!=="open"){
  host.append(el("p","This report is closed. Its decision history is preserved and cannot be overwritten.","moderation-muted"));
  return;
 }
 const form=el("form",undefined,"moderation-decision-form");
 form.append(el("h3","Record an evidence-based decision"));
 const outcomeWrap=el("label","Investigation outcome");
 const outcome=el("select");outcome.name="outcome";
 for(const [value,text] of [["investigating","Investigating — keep open"],["confirmed","Violation confirmed"],["dismissed","Not substantiated — dismiss"]]){
  const o=el("option",text);o.value=value;outcome.append(o);
 }
 outcomeWrap.append(outcome);form.append(outcomeWrap);
 const actionWrap=el("label","Proportionate action");
 const action=el("select");action.name="action";
 const allowedSubject=caseData.subjectId&&caseData.subject?.role==="user"&&caseData.subject?.account_status!=="banned";
 const hideTypes=["post","posts","comment","comments","discussion_message","marketplace_item","video"];
 for(const [value,text,enabled] of [
  ["none","No action",true],["warn","Issue warning",allowedSubject],
  ["hide","Hide reported item",caseData.preview&&hideTypes.includes(record.content_type)],
  ["suspend_24h","Suspend 24 hours",allowedSubject],
  ["suspend_7d","Suspend 7 days",allowedSubject],
  ["ban","Ban account",allowedSubject]
 ]){
  const o=el("option",text);o.value=value;o.disabled=!enabled;action.append(o);
 }
 actionWrap.append(action);form.append(actionWrap);
 const evidence=inputControl(form,"Evidence reviewed (minimum 20 characters)","evidence");
 const reason=inputControl(form,"Decision and justification (minimum 20 characters)","reason");
 const banWrap=el("label","Type BAN to confirm a permanent ban");
 const banInput=el("input");banInput.name="banConfirm";banInput.autocomplete="off";banWrap.append(banInput);form.append(banWrap);
 const sync=()=>{
  if(outcome.value!=="confirmed"){action.value="none";action.disabled=true;}else action.disabled=false;
  banWrap.hidden=action.value!=="ban";banInput.required=!banWrap.hidden;
 };
 outcome.addEventListener("change",sync);action.addEventListener("change",sync);sync();
 const button=el("button","Save audited decision","btn primary");button.type="submit";
 const feedback=el("p","A report does not prove a violation. Check the item and prior history before taking action.","moderation-muted");feedback.setAttribute("role","status");
 form.append(button,feedback);
 form.addEventListener("submit",async event=>{
  event.preventDefault();if(!form.reportValidity())return;
  if(action.value==="ban"&&banInput.value.trim()!=="BAN"){feedback.textContent="Type BAN before issuing a permanent ban.";return;}
  if(action.value==="ban"&&!window.confirm("Confirm permanent ban after reviewing all evidence?"))return;
  const payload={kind:"decision",reportId:record.id,outcome:outcome.value,action:action.value,
   evidence:evidence.value.trim(),reason:reason.value.trim(),requestId:crypto.randomUUID()};
  button.disabled=true;feedback.textContent="Saving and recording audit…";
  try{await api({body:payload});await loadReportQueue();await openReportCase(record.id);}
  catch(error){feedback.textContent=error.message;button.disabled=false;}
 });
 host.append(form);
}
function reinstateForm(host,details){
 const subject=details.subject;
 const active=(details.sanctions||[]).some(s=>!s.lifted_at&&["ban","suspend_24h","suspend_7d"].includes(s.action));
 if(!active||subject?.role!=="user"||!["suspended","banned"].includes(subject.account_status))return;
 const box=el("details",undefined,"moderation-restore"),summary=el("summary","Review account reinstatement");
 const form=el("form");
 form.append(el("p","Reinstatement reverses an active restriction and is recorded in the audit log."));
 const field=inputControl(form,"Why should the account regain access?","reason");
 const button=el("button","Restore account with audit","btn ghost");button.type="submit";form.append(button);
 const feedback=el("p","");feedback.setAttribute("role","status");form.append(feedback);
 form.addEventListener("submit",async e=>{
  e.preventDefault();if(!form.reportValidity())return;
  if(!window.confirm("Confirm that the restriction should be lifted?"))return;
  button.disabled=true;
  try{await api({body:{kind:"reinstate",targetId:subject.id,reason:field.value.trim(),requestId:crypto.randomUUID()}});await openReportCase(details.report.id);}
  catch(error){feedback.textContent=error.message;button.disabled=false;}
 });
 box.append(summary,form);host.append(box);
}
export async function openReportCase(id){
 if(!uuid.test(id))return;
 const host=$("modReportDetail"),list=$("modReportListSection");
 if(!host||!list)return;
 host.hidden=false;list.hidden=true;host.replaceChildren(el("p","Loading the evidence and previous decisions…"));
 try{
  const details=(await api({id})).case,record=details.report;
  host.replaceChildren();
  const back=el("button","← Back to reports","btn ghost");back.type="button";
  back.addEventListener("click",()=>{host.hidden=true;list.hidden=false;});
  host.append(back,el("h2","Investigation: "+human(record.content_type)));
  const grid=el("div",undefined,"moderation-case-grid");
  const complaint=el("section",undefined,"moderation-info");
  complaint.append(el("h3","Complaint and context"));
  label(complaint,"Reason",record.reason);
  label(complaint,"Reporter",details.reporter?.display_name||details.reporter?.username||"Reporter not available");
  label(complaint,"Submitted",date(record.created_at));
  label(complaint,"Related reports",""+details.relatedReportCount+" about this exact item");
  const evidence=el("section",undefined,"moderation-info");
  evidence.append(el("h3","Original reported item"));
  label(evidence,"Item",details.preview?.title||human(record.content_type));
  label(evidence,"Content excerpt",details.preview?.text||details.accessNote||"Item removed or unavailable");
  label(evidence,"Content status",details.preview?.status||"Unknown");
  label(evidence,"Reported account",details.subject?.display_name||details.subject?.username||"Unable to establish");
  label(evidence,"Account standing",details.subject?.account_status||"Unverified");
  grid.append(complaint,evidence);host.append(grid);
  const history=el("section",undefined,"moderation-case-history");
  history.append(el("h3","Automated signals and review history"));
  for(const flag of details.automaticFlags||[]){
   history.append(el("p","Automated signal: "+(flag.signals||[]).join(", ")+". Risk "+flag.risk_score+"/100. These are indicators, not proof.","moderation-warning"));
  }
  for(const note of details.notes||[]){
   const card=el("article",undefined,"moderation-history-item");
   card.append(el("strong",human(note.outcome)+" · "+human(note.action)),el("small",date(note.created_at)));
   label(card,"Evidence considered",note.evidence_summary);
   label(card,"Reason recorded",note.reason);history.append(card);
  }
  for(const sanction of details.sanctions||[]){
   const card=el("article",undefined,"moderation-history-item");
   card.append(el("strong","Account sanction: "+human(sanction.action)),el("small",date(sanction.created_at)));
   label(card,"Reason",sanction.reason);
   label(card,"Expires",sanction.lifted_at?"Lifted "+date(sanction.lifted_at):sanction.ends_at?date(sanction.ends_at):"No automatic expiry");
   history.append(card);
  }
  if(!(details.notes?.length||details.sanctions?.length||details.automaticFlags?.length))history.append(el("p","No prior review decisions are recorded."));
  host.append(history);
  investigationForm(host,record,details);reinstateForm(host,details);
  host.scrollIntoView({block:"start",behavior:"smooth"});
 }catch(error){
  host.replaceChildren(el("p",error.message||"The investigation could not be loaded."));
  const back=el("button","Back to queue","btn ghost");back.addEventListener("click",()=>{host.hidden=true;list.hidden=false;});host.append(back);
 }
}
export function mountReportInvestigator(){
 $("modReportSearch")?.addEventListener("input",renderList);
 $("modReportFilter")?.addEventListener("change",()=>{state.page=0;void loadReportQueue();});
 $("modReportsRefresh")?.addEventListener("click",()=>void loadReportQueue());
 $("modReportsPrev")?.addEventListener("click",()=>{state.page=Math.max(0,state.page-1);void loadReportQueue();});
 $("modReportsNext")?.addEventListener("click",()=>{if((state.page+1)*40<state.total){state.page++;void loadReportQueue();}});
 const requested=new URLSearchParams(location.search).get("report");
 if(requested&&uuid.test(requested))void openReportCase(requested);
}
