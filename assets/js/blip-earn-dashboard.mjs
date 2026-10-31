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
