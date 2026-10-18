import {getSession} from "./supabase.js";
import {escapeHTML} from "./utils.js";

/* This module owns the verification review UI and does not modify admin.js
 * role-management or the general Requests inbox. All approval logic lives
 * server-side in the audited, transactional review RPC. */
const $=id=>document.getElementById(id);
let page=1;
let loaded=false;
let busy=false;
const safe=value=>escapeHTML(String(value??""));
async function request(query="",payload=null){
 const session=await getSession();
 if(!session?.access_token)throw Error("Your staff session has expired. Sign in again.");
 const response=await fetch("/.netlify/functions/verification-review"+query,{
   method:payload?"POST":"GET",
   headers:{Authorization:"Bearer "+session.access_token,...(payload?{"Content-Type":"application/json"}:{})},
   ...(payload?{body:JSON.stringify(payload)}:{})
 });
 let result={};
 try{result=await response.json();}catch{throw Error("Verification review service returned an unexpected response.");}
 if(!response.ok)throw Error(result.error||"Unable to process the review.");
 return result;
}
function setStatus(message,error=false){
 const target=$("verificationReviewStatus");
 if(!target)return;
 target.textContent=message;
 target.dataset.tone=error?"error":"success";
}
function renderApplication(item){
 const documents=(item.documents||[]).map(file=>
  '<button type="button" class="btn ghost sm" data-review-proof="'+safe(item.id)+
  '" data-proof-index="'+Number(file.index)+'">Open secure '+safe(file.type)+' evidence</button>'
 ).join("");
 return '<article class="verification-review-item" data-review-card="'+safe(item.id)+'">'+
  '<div class="verification-review-heading"><div><h3>'+safe(item.user_name||"Member")+
  '</h3><p>'+safe(item.user_email||"")+'</p></div>'+
  '<strong class="tz-verified-role-label">'+safe(String(item.verification_type||"unknown").toUpperCase())+'</strong></div>'+
  '<p class="verification-review-meta">Submitted '+safe(new Date(item.created_at).toLocaleString())+
  ' · Automated triage: '+Number(item.triage_score||0)+'/100</p>'+
  (item.triage_flags?.length?'<p class="verification-review-flags">Needs attention: '+
    safe(item.triage_flags.join(", "))+'</p>':'')+
  '<details><summary>Applicant statement</summary><p class="verification-review-statement">'+safe(item.message||"")+'</p></details>'+
  '<div class="verification-proof-list">'+(documents||'<span>No evidence documents attached</span>')+'</div>'+
  '<label>Approved level<select data-review-level="'+safe(item.id)+'">'+
    ['silver','gold','platinum',...(item.verification_type==="business"?['business']:[])].map(t=>
    '<option value="'+t+'" '+(t===(item.verification_type==="creator"?"silver":item.verification_type)?"selected":"")+'>'+
     t[0].toUpperCase()+t.slice(1)+'</option>').join("")+'</select></label>'+
  '<label>Reviewer evidence and decision notes<textarea data-review-note="'+safe(item.id)+
  '" minlength="25" maxlength="1800" rows="3" placeholder="Describe the identity evidence checked and decision rationale. Never paste private document contents."></textarea></label>'+
  '<div class="verification-review-actions"><button class="btn sm" type="button" data-review-decision="approved" data-review-id="'+
   safe(item.id)+'">Approve after checking evidence</button>'+
  '<button class="btn danger sm" type="button" data-review-decision="rejected" data-review-id="'+safe(item.id)+'">Reject application</button></div>'+
  '</article>';
}
async function loadVerificationQueue(){
 if(busy)return;
 busy=true;
 $("verificationQueue").innerHTML='<p class="hint">Loading pending verification applications…</p>';
 $("verificationPrev").disabled=true;$("verificationNext").disabled=true;
 try{
  const result=await request("?page="+page);
  const apps=result.applications||[];
  $("verificationQueue").innerHTML=apps.length?
    apps.map(renderApplication).join(""):
    '<div class="callout">No pending verification applications. New applications will appear automatically.</div>';
  $("verificationPageLabel").textContent="Page "+page;
  $("verificationPrev").disabled=page<=1;
  $("verificationNext").disabled=!result.hasMore;
  setStatus("Staff review is required for identity verification. Automated checks flag risk but never award badges.");
  loaded=true;
 }catch(error){setStatus(error.message,true);$("verificationQueue").innerHTML='<div class="callout">Could not load the verification queue. Retry from this tab.</div>';}
 finally{busy=false;}
}
async function handleDocument(button){
 const id=button.dataset.reviewProof;
 const index=Number(button.dataset.proofIndex);
 button.disabled=true;
 const original=button.textContent;
 button.textContent="Securing document…";
 try{
  const result=await request("?applicationId="+encodeURIComponent(id)+"&proofIndex="+index);
  const link=document.createElement("a");
  link.href=result.url;link.target="_blank";link.rel="noopener noreferrer";
  link.textContent="View secured evidence (expires in 2 minutes)";
  button.replaceWith(link);
 }catch(error){setStatus(error.message,true);button.disabled=false;button.textContent=original;}
}
async function handleDecision(button){
 if(busy)return;
 const id=button.dataset.reviewId;
 const card=button.closest("[data-review-card]");
 const note=card?.querySelector("[data-review-note]")?.value.trim()||"";
 const decision=button.dataset.reviewDecision;
 const level=card?.querySelector("[data-review-level]")?.value||"silver";
 if(note.length<25){setStatus("Write at least 25 characters explaining what evidence you reviewed.",true);return;}
 const label=decision==="approved"?"Approve verification as "+level:"Reject the verification request";
 if(!window.confirm(label+"? This decision will be audited and notified to the applicant."))return;
 busy=true;button.disabled=true;
 try{
   const result=await request("",{applicationId:id,decision,level,note});
   setStatus("Verification "+result.review.decision+" and audit saved.");
   busy=false;await loadVerificationQueue();
 }catch(error){setStatus(error.message,true);busy=false;button.disabled=false;}
}
export function mountVerificationReview(){
 const nav=document.querySelector('.admin-nav button[data-tab="verification"]');
 const host=$("verificationQueue");
 if(!nav||!host)return;
 nav.addEventListener("click",()=>void loadVerificationQueue());
 $("verificationRefresh")?.addEventListener("click",()=>void loadVerificationQueue());
 $("verificationPrev")?.addEventListener("click",()=>{if(page>1){page--;void loadVerificationQueue();}});
 $("verificationNext")?.addEventListener("click",()=>{page++;void loadVerificationQueue();});
 host.addEventListener("click",event=>{
  const target=event.target.closest("button");
  if(target?.dataset.reviewProof)return void handleDocument(target);
  if(target?.dataset.reviewDecision)return void handleDecision(target);
 });
 if(new URLSearchParams(location.search).get("tab")==="verification")nav.click();
}
