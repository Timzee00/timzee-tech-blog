import {getSession} from "./supabase.js";
const $=id=>document.getElementById(id);
const node=(tag,text,cls)=>{
 const e=document.createElement(tag);
 if(text!==undefined)e.textContent=String(text||"");
 if(cls)e.className=cls;
 return e;
};
let currentPage=0,total=0;
async function call(args={}){
 const session=await getSession();
 if(!session?.access_token)throw Error("Sign in again with a moderator account.");
 const qs=new URLSearchParams();
 if(args.flag)qs.set("flag",String(args.flag));
 else{qs.set("queue","flags");qs.set("status",args.status||"pending");qs.set("page",String(args.page||0));}
 const response=await fetch("/.netlify/functions/moderation-cases"+(args.body?"":"?"+qs),{
  method:args.body?"POST":"GET",cache:"no-store",
  headers:{Authorization:"Bearer "+session.access_token,...(args.body?{"Content-Type":"application/json"}:{})},
  ...(args.body?{body:JSON.stringify(args.body)}:{})
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||"The safety review could not be completed.");
 return data;
}
export async function loadSafetyFlags(){
 const status=$("modFlagStatus")?.value||"pending";
 const target=$("modFlagList");
 if(!target)return;
 target.replaceChildren(node("p","Loading the safety queue…"));
 try{
  const response=await call({status,page:currentPage});total=response.total||0;
  target.replaceChildren();
  if(!response.flags?.length)target.append(node("p","No safety flags currently match this filter."));
  for(const flag of response.flags||[]){
   const card=node("article",undefined,"moderation-report-card");
   const top=node("div",undefined,"moderation-report-top");
   top.append(node("strong",String(flag.target_type||"content").replaceAll("_"," ")));
   top.append(node("span",flag.state==="pending"?"Needs review":String(flag.state||"Reviewed"),"moderation-status"));
   card.append(top);
   card.append(node("p","Risk score "+flag.risk_score+"/100 · "+(flag.signals||[]).join(", ")));
   card.append(node("small",new Date(flag.created_at).toLocaleString()));
   const button=node("button",flag.state==="pending"?"Review flag":"View flag","btn ghost");
   button.type="button";button.addEventListener("click",()=>void openFlag(flag.id));
   card.append(button);target.append(card);
  }
  if($("modFlagCount"))$("modFlagCount").textContent=total+" safety flags in this status · Page "+(currentPage+1);
  if($("modFlagPrev"))$("modFlagPrev").disabled=currentPage===0;
  if($("modFlagNext"))$("modFlagNext").disabled=(currentPage+1)*40>=total;
 }catch(error){target.replaceChildren(node("p",error.message));}
}
async function openFlag(id){
 const host=$("modFlagDetails"),list=$("modFlagListSection");
 if(!host||!list)return;
 host.hidden=false;list.hidden=true;host.replaceChildren(node("p","Loading the flagged content…"));
 try{
  const data=(await call({flag:id})).details,flag=data.flag;
  host.replaceChildren();
  const back=node("button","← Back to safety queue","btn ghost");
  back.addEventListener("click",()=>{host.hidden=true;list.hidden=false;});host.append(back);
  host.append(node("h3","Automated safety review"));
  const box=node("section",undefined,"moderation-info");
  const add=(title,value)=>{
   const wrap=node("div",undefined,"moderation-detail-line");
   wrap.append(node("strong",title),node("p",String(value||"Unavailable")));box.append(wrap);
  };
  add("Reason for flag",(flag.signals||[]).join(", "));
  add("Risk score",flag.risk_score+"/100 · Signals are not proof of a rule violation");
  add("Content",data.preview?.text||"Content was removed or could not be retrieved");
  add("Content status",data.preview?.status||"Unavailable");
  add("Author",data.subject?.display_name||data.subject?.username||"Unavailable");
  host.append(box);
  if(flag.state!=="pending"){host.append(node("p","This safety flag was already reviewed. Its original record remains available."));return;}
  const form=node("form",undefined,"moderation-decision-form");
  form.append(node("h3","Decision on this automated flag"));
  const pick=node("label","Decision");const choose=node("select");
  for(const [value,text] of [["approve","Approve / release if automatically held"],["hide","Keep or place content on hold"],["dismiss","Dismiss false positive"]]){
   const opt=node("option",text);opt.value=value;
   if(value==="hide"&&!["post","posts","comment","comments","discussion_message","marketplace_item","video"].includes(flag.target_type))opt.disabled=true;
   choose.append(opt);
  }
  pick.append(choose);form.append(pick);
  const wrap=node("label","Evidence and rationale (20–2,000 characters)");
  const evidence=node("textarea");evidence.minLength=20;evidence.maxLength=2000;evidence.rows=4;evidence.required=true;wrap.append(evidence);form.append(wrap);
  const submit=node("button","Record and apply review","btn primary");submit.type="submit";form.append(submit);
  const feedback=node("p","Mass reports and risk scores alone must not justify punishment.","moderation-muted");feedback.setAttribute("role","status");form.append(feedback);
  form.addEventListener("submit",async event=>{
   event.preventDefault();if(!form.reportValidity())return;
   if(choose.value==="hide"&&!window.confirm("Confirm the evidence justifies temporarily hiding this item?"))return;
   submit.disabled=true;feedback.textContent="Recording audited decision…";
   try{
    await call({body:{kind:"flag_review",flagId:flag.id,decision:choose.value,reason:evidence.value.trim(),requestId:crypto.randomUUID()}});
    await loadSafetyFlags();await openFlag(flag.id);
   }catch(error){feedback.textContent=error.message;submit.disabled=false;}
  });
  host.append(form);
  host.scrollIntoView({block:"start",behavior:"smooth"});
 }catch(error){host.replaceChildren(node("p",error.message));const back=node("button","Back to safety queue","btn ghost");back.addEventListener("click",()=>{host.hidden=true;list.hidden=false;});host.append(back);}
}
export function mountSafetyFlags(){
 $("modFlagStatus")?.addEventListener("change",()=>{currentPage=0;void loadSafetyFlags();});
 $("modFlagRefresh")?.addEventListener("click",()=>void loadSafetyFlags());
 $("modFlagPrev")?.addEventListener("click",()=>{currentPage=Math.max(0,currentPage-1);void loadSafetyFlags();});
 $("modFlagNext")?.addEventListener("click",()=>{if((currentPage+1)*40<total){currentPage++;void loadSafetyFlags();}});
}
