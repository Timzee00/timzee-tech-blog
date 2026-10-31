import {supabase} from "./supabase.js";
const $=id=>document.getElementById(id);
const ENDPOINT="/.netlify/functions/blip-earn";
let token=null,lastState=null;
function gate(text,error=false){const el=$("befGate");el.textContent=text;el.dataset.error=String(error);}
async function invoke(view,payload=null){
 const headers={Authorization:"Bearer "+token};
 if(payload)headers["Content-Type"]="application/json";
 const res=await fetch(ENDPOINT+(payload?"":"?view="+view),{
  method:payload?"POST":"GET",headers,
  ...(payload?{body:JSON.stringify(payload)}:{}),
  cache:"no-store"
 });
 let value={};try{value=await res.json();}catch{}
 if(!res.ok)throw Error(value.error||"Could not reach Blip Earn controls.");
 return value;
}
function render(data){
 const state=data.program||{};
 lastState=state;
 $("befActivated").textContent=Number(state.activated_members||0).toLocaleString();
 $("befRecent").textContent=Number(state.recent_signins_30d||0).toLocaleString();
 $("befAttributed").textContent=Number(data.tracking?.attributed||0).toLocaleString();
 $("befPending").textContent=Number(data.tracking?.pending||0).toLocaleString();
 $("befEnabled").checked=state.enabled===true;
 $("befTarget").value=Number(state.target_activated_members||0);
 $("befUpdated").textContent=state.updated_at
   ?"Last configured: "+new Date(state.updated_at).toLocaleString() : "No program changes recorded.";
 $("befProgramStatus").textContent=state.accepting_referrals
  ?"Accepting new referrals. No cash awards or payouts are enabled."
  :state.target_reached
  ?"Automatically paused: the verified-onboarded member target has been met. Raise the target or disable the program manually."
  :"New referrals are paused. Existing records remain intact.";
 const history=$("befAuditHistory");
 if(history){
   history.replaceChildren();
   const events=Array.isArray(data.history)?data.history:[];
   if(!events.length){
     const empty=document.createElement("li");
     empty.textContent="No configuration changes recorded yet.";
     history.append(empty);
   }
   for(const entry of events.slice(0,15)){
     const item=document.createElement("li");
     const heading=document.createElement("strong");
     heading.textContent=entry.enabled?"Referrals switched on":"Referrals paused";
     const details=document.createElement("small");
     const timestamp=Number.isFinite(Date.parse(entry.at))?new Date(entry.at).toLocaleString():"Unknown time";
     const target=Number.isInteger(Number(entry.target))?Number(entry.target):0;
     details.textContent=timestamp+" · Goal: "+(target?target.toLocaleString()+" verified members":"manual only");
     const reason=document.createElement("small");
     reason.textContent="Reason: "+String(entry.reason||"Not provided").slice(0,500);
     item.append(heading,details,reason);
     history.append(item);
   }
 }
 displayRewardControls(data);
 displayReviewQueue(Array.isArray(data.reviews)?data.reviews:[]);
 displayPaymentQueue(Array.isArray(data.reward_queue)?data.reward_queue:[]);
 displayWinners(Array.isArray(data.winners)?data.winners:[]);
 $("befWorkspace").hidden=false;
 gate("Super Admin access confirmed. Changes to this switch are audited in the database.");
}

let approvedWinners=[];
function element(tag,className,textContent) {
 const el=document.createElement(tag);
 if(className)el.className=className;
 if(textContent!==undefined)el.textContent=String(textContent);
 return el;
}
function status(el,message,error=false){
 el.textContent=message;
 el.dataset.error=String(error);
}
function displayRewardControls(data){
 const ctrl=data.reward_controls||{};
 $("befRewardEnabled").checked=ctrl.enabled===true;
 $("befAwardCap").value=Number(ctrl.max_awards||0);
 $("befVerifiedChat").value=String(ctrl.official_staff_username||"");
 $("befChannelUrl").value=String(ctrl.winners_channel_url||"");
 $("befBudgetText").textContent="Configured maximum commitment: ₦"+
   (Number(ctrl.max_awards||0)*1000).toLocaleString()+" · manual only";
}
function displayReviewQueue(rows){
 const host=$("befReviewQueue");host.replaceChildren();
 if(!rows.length){host.append(element("p","","No referrals are currently awaiting review."));return;}
 for(const review of rows.slice(0,25)){
   const card=element("article","bef-queue-item");
   const title=element("strong","", "@"+review.referred_username+" · invited by @"+review.inviter_username);
   const days=Math.max(0,Number(review.active_days||0));
   const actions=Math.max(0,Number(review.engagement_events||0));
   const metric=element("p","",days+" distinct days of engagement · "+actions+" persisted actions");
   const note=element("p","bef-note-text","Members need 3 different participation days and a human check. Approving one referral is irreversible through this interface.");
   const reason=element("textarea");reason.placeholder="Reason for approval or rejection (minimum 12 characters)";
   reason.maxLength=500;reason.setAttribute("aria-label","Review reason for @"+review.referred_username);
   const actionsRow=element("div","bef-actions");
   const approve=element("button","bef-action","Approve genuine referral");
   const reject=element("button","bef-action secondary","Reject referral");
   approve.type="button";reject.type="button";approve.disabled=days<3||actions<3;
   const output=element("small","bef-out");output.setAttribute("role","status");
   async function decide(decision){
     const noteText=reason.value.trim();
     if(noteText.length<12){status(output,"Write a meaningful reason (at least 12 characters).",true);return;}
     if(!confirm((decision==="qualified"?"Approve":"Reject")+" this referral for @"+review.referred_username+"? The action will be audited."))return;
     approve.disabled=true;reject.disabled=true;
     status(output,"Saving audited decision…");
     try{
       await invoke("",{action:"admin-review",referred_id:review.referred_id,decision,reason:noteText});
       await refresh();
     }catch(error){
       status(output,error.message||"Review failed.",true);
       approve.disabled=days<3||actions<3;reject.disabled=false;
     }
   }
   approve.addEventListener("click",()=>void decide("qualified"));
   reject.addEventListener("click",()=>void decide("rejected"));
   actionsRow.append(approve,reject);card.append(title,metric,note,reason,actionsRow,output);
   host.append(card);
 }
}
function displayPaymentQueue(rows){
 const host=$("befPaymentQueue");host.replaceChildren();
 if(!rows.length){host.append(element("p","","No manual reward records yet."));return;}
 for(const award of rows.slice(0,30)){
   const card=element("article","bef-queue-item");
   card.append(element("strong","","@"+award.username+" · Milestone "+Number(award.milestone)+" · ₦"+
     Number(award.amount_naira||1000).toLocaleString()));
   const detail=element("p","",award.status==="requested"
     ?"REQUESTED · "+(award.method==="airtime"?"Airtime":"Bank transfer")+" · Pay personally before marking paid"
     :award.status==="paid"?"PAID · Founder-confirmed manual payment"
     :"AVAILABLE · Waiting for member request");
   card.append(detail);
   if(award.status==="requested"){
     const note=element("textarea");
     note.placeholder="Short non-sensitive confirmation, e.g. I personally sent airtime, checked recipient and verified receipt.";
     note.maxLength=500;
     note.setAttribute("aria-label","Private manual payment confirmation for @"+award.username);
     const payButton=element("button","bef-action","I have personally paid ₦1,000");
     payButton.type="button";
     const output=element("small","bef-out");output.setAttribute("role","status");
     payButton.addEventListener("click",async()=>{
       if(note.value.trim().length<12){status(output,"A confirmation reason of 12 characters is required.",true);return;}
       if(!confirm("Have you ALREADY personally paid @"+award.username+" ₦1,000? This marks the record PAID, but sends NO money."))return;
       payButton.disabled=true;
       try{await invoke("",{action:"admin-paid",award_id:award.id,note:note.value.trim()});await refresh();}
       catch(error){status(output,error.message,true);payButton.disabled=false;}
     });
     card.append(note,payButton,output);
   }
   if(award.status==="paid"){
     if(award.consent){
       const published=Boolean(award.published);
       const button=element("button","bef-action",published?"Remove from winners board":"Publish consenting winner");
       button.type="button";
       const output=element("small","bef-out");output.setAttribute("role","status");
       button.addEventListener("click",async()=>{
         if(!confirm((published?"Unpublish":"Publish")+" @"+award.username+" on the public winners board?"))return;
         button.disabled=true;
         try{await invoke("",{action:"admin-publish",award_id:award.id,publish:!published});await refresh();}
         catch(error){status(output,error.message,true);button.disabled=false;}
       });
       card.append(button,output);
     }else card.append(element("p","bef-note-text","Recipient has not consented to public winner announcements."));
   }
   host.append(card);
 }
}
function displayWinners(rows){
 const host=$("befWinnersPreview");host.replaceChildren();
 approvedWinners=rows.slice(0,30);
 if(!approvedWinners.length){host.append(element("p","","No consenting, paid winners have been published yet."));return;}
 for(const item of approvedWinners){
   const card=element("div","bef-queue-item");
   card.append(element("strong","","@"+item.username+" · ₦"+Number(item.amount_naira||1000).toLocaleString()));
   card.append(element("small","bef-note-text","Confirmed paid milestone "+item.milestone));
   host.append(card);
 }
}

async function refresh(){const data=await invoke("admin");render(data);}
$("befSettingsForm").addEventListener("submit",async event=>{
 event.preventDefault();
 if(!token)return;
 const enabled=$("befEnabled").checked, target=Number($("befTarget").value),reason=$("befReason").value.trim();
 if(!Number.isSafeInteger(target)||target<0||target>10000000){
   gate("Enter a valid target between 0 and 10 million.",true);return;
 }
 if(reason.length<12||reason.length>500){gate("Explain the reason for the change (12–500 characters).",true);$("befReason").focus();return;}
 const changingFrom=lastState?.enabled===true;
 const action=enabled?"enable invitation tracking":"pause new referrals";
 if(!confirm("Confirm: "+action+". Existing referral records remain saved. This does NOT enable cash rewards or payouts.")){
  $("befEnabled").checked=changingFrom;return;
 }
 const button=$("befSave");button.disabled=true;
 gate("Saving changes securely…");
 try{
   await invoke("",{action:"admin-config",enabled,target,reason});
   $("befReason").value="";
   await refresh();
 }catch(error){gate(error.message||"Unable to save changes.",true);$("befEnabled").checked=changingFrom;}
 finally{button.disabled=false;}
});

$("befAwardCap").addEventListener("input",()=>{
 const amount=Number($("befAwardCap").value||0)*1000;
 $("befBudgetText").textContent="Configured maximum commitment: ₦"+amount.toLocaleString()+" · manual only";
});
$("befRewardForm").addEventListener("submit",async event=>{
 event.preventDefault();
 const button=$("befRewardSave"),enabled=$("befRewardEnabled").checked,
   max_awards=Number($("befAwardCap").value);
 const reason=$("befRewardReason").value.trim();
 if(!Number.isSafeInteger(max_awards)||max_awards<0||max_awards>1000||
    (enabled&&max_awards===0)||reason.length<12||reason.length>500){
    status($("befRewardFeedback"),"Select an explicit award cap and enter a 12–500 character audit reason.",true);return;
 }
 if(!confirm("Save personal reward funding? Maximum commitment is ₦"+
    (max_awards*1000).toLocaleString()+
    ". No bank gateway is enabled and past awards remain payable when paused."))return;
 button.disabled=true;status($("befRewardFeedback"),"Saving your funding cap securely…");
 try{
  await invoke("",{action:"admin-rewards-config",enabled,max_awards,
   chat_username:$("befVerifiedChat").value.trim(),
   channel_url:$("befChannelUrl").value.trim(),reason});
  $("befRewardReason").value="";
  await refresh();
  status($("befRewardFeedback"),"Manual rewards settings saved and audited.");
 }catch(error){status($("befRewardFeedback"),error.message||"Unable to save reward funding.",true);}
 finally{button.disabled=false;}
});
$("befMintForm").addEventListener("submit",async event=>{
 event.preventDefault();
 const username=$("befMintUsername").value.trim().replace(/^@/,"");
 if(!/^[a-z0-9_]{3,32}$/i.test(username)){
  status($("befMintFeedback"),"Enter a valid existing account username.",true);return;
 }
 const button=$("befMintButton");button.disabled=true;
 status($("befMintFeedback"),"Verifying approved milestones and founder funding…");
 try{
  const info=await invoke("",{action:"admin-mint",owner_username:username});
  await refresh();
  status($("befMintFeedback"),Number(info.mint?.created||0)+" new milestone awards created. "+(info.mint?.reason||""));
 }catch(error){status($("befMintFeedback"),error.message||"Milestone review failed.",true);}
 finally{button.disabled=false;}
});
$("befCopyWinners").addEventListener("click",async()=>{
 if(!approvedWinners.length){status($("befWinnerFeedback"),"There are no consenting, paid winners to announce.",true);return;}
 const message="BLIPMOOD · BLIP EARN WINNERS\n"+
  approvedWinners.map(item=>"🎉 @"+item.username+" — ₦"+
   Number(item.amount_naira||1000).toLocaleString()+
   " · Milestone "+item.milestone).join("\n")+
   "\n\nVerified and personally paid by Blipmood. Thanks for building our community.";
 try{await navigator.clipboard.writeText(message);
   status($("befWinnerFeedback"),"Copied approved winners. Post this in your own channel when ready.");
 }catch{status($("befWinnerFeedback"),"Clipboard not available. Copy names from the list below.",true);}
});

async function boot(){
 const {data:{session},error}=await supabase.auth.getSession();
 if(error||!session?.access_token){gate("Sign in as a Super Admin before using referral controls.",true);return;}
 token=session.access_token;
 try{await refresh();}catch(error){gate(error.message||"Permission denied or the referral database is unavailable.",true);}
}
void boot().catch(error=>gate(error.message||"Unable to open founder controls.",true));
