import {supabase} from "./supabase.js";
import {captureReferralCode,pendingReferralCode,clearPendingReferralCode,validReferralCode,normalizeReferralCode} from "./referral-capture.mjs";
const $ = id => document.getElementById(id);
const ENDPOINT = "/.netlify/functions/blip-earn";
let program = null;
let token = null;
let storedCode = null;
const showStatus = (message,error=false) => {
  const node = $("beStatus");
  node.textContent = message;
  node.dataset.error = String(error);
};
const asCount = value => Number.isSafeInteger(Number(value)) && Number(value) >= 0 ? Number(value) : 0;
async function request(view) {
  const r = await fetch(ENDPOINT+"?view="+encodeURIComponent(view), {
    cache:"no-store",headers:token?{Authorization:"Bearer "+token}:{}
  });
  let data={};try { data = await r.json(); } catch { /* unavailable */ }
  if(!r.ok)throw Error(data.error||"Referral service unavailable.");
  return data;
}
async function post(action,rest={}) {
  const r = await fetch(ENDPOINT,{
    method:"POST",
    headers:{"Content-Type":"application/json",Authorization:"Bearer "+token},
    body:JSON.stringify({action,...rest}),
    cache:"no-store"
  });
  let data={};try{data=await r.json();}catch{}
  if(!r.ok)throw Error(data.error||"Request could not be completed.");
  return data;
}
function renderRewards(data){
 const host=$("beRewardsList"),notice=$("beRewardsHelp"),contact=$("beOfficialChat");
 host.replaceChildren();
 const awards=Array.isArray(data.awards)?data.awards:[];
 const funded=data.reward_program?.manual_funding_open===true;
 notice.textContent=funded
  ?"Founder-funded rewards are enabled with a fixed budget cap. Every 10 approved referrals may qualify for ₦1,000, subject to remaining funds and staff verification."
  :"Founder-funded cash or airtime awards are paused. Previously approved awards remain recorded and may still be requested.";
 if(!awards.length){
   const empty=document.createElement("p");empty.textContent="No ₦1,000 manual awards have been approved for your account yet.";
   host.append(empty);
 }
 for(const award of awards){
   const card=document.createElement("article");card.className="be-award";
   const label=document.createElement("strong");
   label.textContent="Milestone "+Number(award.milestone_no||0)+" · ₦"+Number(award.amount_naira||1000).toLocaleString();
   const status=document.createElement("p");
   const descriptions={
     available:"Approved for manual claim · not yet paid",
     requested:"Your request is awaiting the founder's personal payment",
     paid:"Marked paid by Blipmood staff"
   };
   status.textContent=descriptions[award.status]||"Status pending";
   card.append(label,status);
   if(award.status==="available"){
     const choose=document.createElement("select");choose.className="be-select";choose.setAttribute("aria-label","Choose payout type");
     for(const [key,value] of [["bank","Bank transfer"],["airtime","Airtime"]]){
       const item=document.createElement("option");item.value=key;item.textContent=value;choose.append(item);
     }
     const consentLabel=document.createElement("label");
     const consent=document.createElement("input");consent.type="checkbox";consent.checked=false;
     const consentText=document.createElement("span");
     consentText.textContent="If the founder pays me, I agree to show my public @username and ₦1,000 award on Blipmood's winners board and its official announcement channel. Channel posts may not be removable instantly.";
     consentLabel.append(consent,consentText);
     const button=document.createElement("button");button.type="button";button.className="be-button";
     button.textContent="Request manual payment";
     const msg=document.createElement("small");msg.className="be-mini-status";msg.setAttribute("role","status");
     button.addEventListener("click",async()=>{
       if(button.disabled)return;
       if(!confirm("Request manual "+(choose.value==="airtime"?"airtime":"bank transfer")+" from Blipmood? Do not send bank details or OTPs here."))return;
       button.disabled=true;msg.textContent="Sending your manual reward request…";
       try{
         await post("member-request",{award_id:award.id,method:choose.value,public_consent:consent.checked});
         await reload();
       }catch(error){msg.textContent=error.message||"Request failed.";button.disabled=false;}
     });
     card.append(choose,consentLabel,button,msg);
   }
   if(award.status==="requested"||award.status==="paid"){
     const setting=document.createElement("button");setting.type="button";setting.className="be-button secondary";
     const opted=Boolean(award.public_consent_at);
     setting.textContent=opted?"Withdraw winner-list permission":"Allow showing my @username if paid";
     const msg=document.createElement("small");msg.className="be-mini-status";msg.setAttribute("role","status");
     setting.addEventListener("click",async()=>{
       const nowOptIn=!opted;
       if(opted&&!confirm("Withdraw publication consent? Blipmood will remove your site listing, but any existing external channel announcement must be removed manually by staff."))return;
       setting.disabled=true;
       try{await post("member-consent",{award_id:award.id,public_consent:nowOptIn});await reload();}
       catch(error){msg.textContent=error.message||"Could not update consent.";setting.disabled=false;}
     });
     card.append(setting,msg);
     if(award.status==="requested"){
       const prompt=document.createElement("p");prompt.className="be-footnote";
       prompt.textContent="Use only the official staff chat shown below to arrange the cash or airtime payment. Never send an OTP, PIN or password.";
       card.append(prompt);
     }
   }
   host.append(card);
 }
 contact.replaceChildren();
 const official=data.official_chat;
 if(official?.link?.startsWith("/chat.html?user=") && typeof official.username==="string"){
   const link=document.createElement("a");link.href=official.link;link.className="be-home";
   link.textContent="Open verified Blipmood staff chat · @"+official.username;
   contact.append(link);
 }else{
   contact.textContent="No verified payout support account is configured yet. Please do not send bank details to random accounts.";
 }
}
function render(data) {
  program = data.program || {};
  storedCode = data.code || null;
  const pending=asCount(data.referrals?.pending);
  const qualified=asCount(data.referrals?.qualified);
  const rejected=asCount(data.referrals?.rejected);
  $("bePending").textContent=pending.toLocaleString();
  $("beQualified").textContent=qualified.toLocaleString();
  $("beRejected").textContent=rejected.toLocaleString();
  const progress=qualified % 10;
  $("beProgressLabel").textContent=progress+" of 10";
  $("beProgress").setAttribute("aria-valuenow",String(progress));
  $("beProgressFill").style.width=progress*10+"%";
  $("beCode").textContent=storedCode||"No code yet";
  $("beGenerate").hidden=Boolean(storedCode);
  $("beGenerate").disabled=!program.accepting_referrals;
  $("beCopy").disabled=!storedCode||!program.accepting_referrals;
  $("beClaimButton").disabled=!program.accepting_referrals;
  $("beClaimPanel").hidden=!program.accepting_referrals;
  $("beCodeHint").textContent=program.accepting_referrals
    ?"Your unique link can be shared while Blipmood accepts new invitations."
    :"Your existing code stays on record. New invitation attributions are paused.";
  renderRewards(data);
  showStatus(program.status_message||"Referral availability is being checked.");
  $("beWorkspace").hidden=false;
}
async function reload() {
  const data=await request("mine");
  render(data);
}
async function boot() {
  captureReferralCode();
  $("beClaimCode").value=pendingReferralCode();
  const {data:{session},error}=await supabase.auth.getSession();
  if(error||!session?.access_token) {
    showStatus("Sign in to view your Blip Earn invitation dashboard.");
    const link=document.createElement("a");
    link.href="/login.html?next="+encodeURIComponent("/blip-earn.html");
    link.className="be-home";
    link.textContent="Sign in";
    $("beStatus").append(" ",link);
    return;
  }
  token=session.access_token;
  try{await reload();}catch(error){showStatus(error.message||"Referral service unavailable.",true);}
}
$("beGenerate").addEventListener("click",async event=>{
  const button=event.currentTarget;
  if(!token||button.disabled)return;
  button.disabled=true;
  try {await post("issue-code");await reload();}
  catch(error){showStatus(error.message,true);}
  finally{button.disabled=false;if(program&&!program.accepting_referrals)button.disabled=true;}
});
$("beCopy").addEventListener("click",async()=>{
  if(!storedCode||!program?.accepting_referrals)return;
  const url=new URL("/login.html",location.origin);
  url.searchParams.set("view","signup");
  url.searchParams.set("ref",storedCode);
  try{await navigator.clipboard.writeText(url.href);showStatus("Invitation link copied. Remember: cash rewards are not active.");}
  catch{showStatus("Copy wasn't available. Your invitation code is "+storedCode+".",true);}
});
$("beClaimForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const code=normalizeReferralCode($("beClaimCode").value);
  if(!validReferralCode(code)){
    $("beClaimFeedback").textContent="Enter a valid invitation code, for example BL followed by 12 hexadecimal characters.";
    $("beClaimCode").focus();return;
  }
  const button=$("beClaimButton");
  button.disabled=true;
  $("beClaimFeedback").textContent="Validating your account and invitation…";
  try{
    const result=await post("claim",{code});
    $("beClaimFeedback").textContent=result.message||"Your referral has been recorded.";
    if(["pending","already_recorded"].includes(result.status)){
      clearPendingReferralCode();
      $("beClaimCode").value="";
    }
    await reload();
  }catch(error){$("beClaimFeedback").textContent=error.message||"Could not record invitation.";}
  finally{button.disabled=!program?.accepting_referrals;}
});
void boot().catch(error=>showStatus(error.message||"Unable to load Blip Earn.",true));
