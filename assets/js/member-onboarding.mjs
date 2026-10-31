import {supabase,getCurrentUser} from "./supabase.js";
import {saveUserPreferences} from "./user-preferences.js";
import {captureReferralCode,pendingReferralCode,clearPendingReferralCode,validReferralCode,normalizeReferralCode} from "./referral-capture.mjs";
const $=id=>document.getElementById(id);
const form=$("setupForm"),status=$("setupMessage");
const stages=[...document.querySelectorAll(".setup-stage")];
let step=1,saving=false,person=null,existing=null,referralsOpen=false;
const REFERRAL_ENDPOINT="/.netlify/functions/blip-earn";
const feedback=text=>{status.textContent=text||"";};
function syncReferralSection() {
 const section=$("setupReferralSection"), input=$("setupReferralCode");
 if(!section||!input)return;
 const age=Number($("setupAge")?.value);
 // Do not market referral incentives to minor accounts.
 section.hidden=!referralsOpen||!Number.isInteger(age)||age<18;
 if(!section.hidden && !input.value)input.value=pendingReferralCode();
}
$("setupAge")?.addEventListener("input",syncReferralSection);
async function loadReferralOffer() {
 try {
  const r=await fetch(REFERRAL_ENDPOINT+"?view=public",{cache:"no-store"});
  if(!r.ok)throw Error("Unavailable");
  const data=await r.json();
  referralsOpen=data?.program?.accepting_referrals===true;
 }catch {referralsOpen=false;}
 syncReferralSection();
}
async function submitReferralCode(code) {
 const {data:{session}}=await supabase.auth.getSession();
 if(!session?.access_token)return;
 const r=await fetch(REFERRAL_ENDPOINT,{method:"POST",
  headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},
  body:JSON.stringify({action:"claim",code})});
 let data={};try{data=await r.json();}catch{}
 if(r.ok && ["pending","already_recorded"].includes(data.status)){
  clearPendingReferralCode();
  return;
 }
 // Non-blocking: onboarding is already saved and other account features must work.
 // The signed-in member can retry the code from Blip Earn within the signup window.
 console.warn("Referral code not yet applied:",r.status);
}

const nextTarget=()=>{
 const next=new URLSearchParams(location.search).get("next")||"index.html";
 try{const url=new URL(next,location.origin);
   return url.origin===location.origin&&!/\/welcome\.html$/.test(url.pathname)?
    url.pathname+url.search+url.hash:"/index.html";
 }catch{return "/index.html";}
};
function setStage(n){
 step=Math.max(1,Math.min(3,n));feedback("");
 for(const fieldset of stages)fieldset.hidden=Number(fieldset.dataset.stage)!==step;
 document.querySelectorAll("[data-progress]").forEach(button=>{
  const number=Number(button.dataset.progress);
  button.classList.toggle("done",number<step);
  if(number===step)button.setAttribute("aria-current","step");
  else button.removeAttribute("aria-current");
 });
 $("setupBack").hidden=step===1;$("setupNext").hidden=step===3;$("setupFinish").hidden=step!==3;
 stages[step-1].querySelector("legend")?.focus?.();
}
function validateStep(n){
 if(n===1){
  const name=$("setupName").value.trim(),username=$("setupUsername").value.trim();
  const age=Number($("setupAge").value),gender=$("setupGender").value;
  if(name.length<2){feedback("Enter a display name of at least 2 characters.");$("setupName").focus();return false;}
  if(!/^[a-zA-Z0-9_]{3,32}$/.test(username)){feedback("Choose a username of 3–32 letters, numbers or underscores.");$("setupUsername").focus();return false;}
  if(!Number.isInteger(age)||age<13||age>120){feedback("Enter your age (13 or older).");$("setupAge").focus();return false;}
  if(!["female","male","prefer_not_to_say"].includes(gender)){feedback("Choose a gender option.");$("setupGender").focus();return false;}
  const referral=$("setupReferralCode")?.value?.trim()||"";
  if(!$("setupReferralSection")?.hidden && referral && !validReferralCode(referral)){
    feedback("Enter a valid invitation code or leave it empty.");
    $("setupReferralCode")?.focus();return false;
  }
  const avatar=avatarSelection();
  if(!allowedStarterAvatar(gender,avatar)){
    feedback("Choose an avatar available for your selected gender.");$("setupGender").focus();return false;
  }
 }
 return true;
}
const allowedStarterAvatar=(gender,avatar)=>gender==="prefer_not_to_say"
 ?["male","female"].includes(avatar):["male","female"].includes(gender)&&gender===avatar;
function syncStarterAvatar(){
 const gender=$("setupGender").value;
 const options=[...form.querySelectorAll('input[name="avatar"]')];
 for(const input of options){
  const permitted=allowedStarterAvatar(gender,input.value);
  input.disabled=!permitted;
  const card=input.closest("label");
  if(card){card.hidden=!permitted;card.setAttribute("aria-disabled",String(!permitted));}
  if(!permitted)input.checked=false;
 }
 const selected=options.find(x=>x.checked&&!x.disabled);
 if(!selected&&["male","female"].includes(gender)){
   const matching=options.find(x=>x.value===gender);
   if(matching)matching.checked=true;
 }
 const note=$("starterAvatarHelp");
 if(note)note.textContent=gender==="male"?"Nova is your available starter illustration. Change gender to access other starter styles."
  :gender==="female"?"Bloom is your available starter illustration. Change gender to access other starter styles."
  :gender==="prefer_not_to_say"?"Choose whichever starter illustration you prefer."
  :"Choose gender first to reveal compatible starter illustrations.";
}
const avatarSelection=()=>{
 const gender=$("setupGender").value;
 const selected=form.querySelector('input[name="avatar"]:checked')?.value||"";
 return allowedStarterAvatar(gender,selected)?selected:(gender==="male"||gender==="female"?gender:"");
};
$("setupGender").addEventListener("change",syncStarterAvatar);
form.querySelectorAll('input[name="avatar"]').forEach(input=>input.addEventListener("change",()=>{
 if(!allowedStarterAvatar($("setupGender").value,input.value)){
   input.checked=false;syncStarterAvatar();
   feedback("Choose a starter illustration available for your selected gender.");
 }
}));
$("setupNext").addEventListener("click",()=>{if(validateStep(step))setStage(step+1);});
$("setupBack").addEventListener("click",()=>setStage(step-1));
document.querySelectorAll("[data-progress]").forEach(button=>button.addEventListener("click",()=>{
 const target=Number(button.dataset.progress);
 if(target<step||target===step||validateStep(step))setStage(target);
}));
form.addEventListener("submit",async event=>{
 event.preventDefault();if(saving||!person||!validateStep(1))return;
 saving=true;const submit=$("setupFinish");submit.disabled=true;submit.textContent="Saving your space…";form.setAttribute("aria-busy","true");
 try{
  const name=$("setupName").value.trim(),username=$("setupUsername").value.trim();
  const currentAvatar=String(existing?.avatar_url||"");
  const isStarter=!currentAvatar||/avatar-placeholder|avatar-(female|male)\.svg/i.test(currentAvatar);
  const avatar=avatarSelection();
  if(!allowedStarterAvatar($("setupGender").value,avatar))throw Error("Select a starter avatar compatible with your gender choice.");
  const avatars={male:"/assets/img/avatar-male.svg",female:"/assets/img/avatar-female.svg"};
  const profile={
   display_name:name,username,
   allow_messages:form.elements.allow_messages.checked,
   allow_requests:form.elements.allow_requests.checked,
   show_email:false,
   notify_messages:form.elements.notify_messages.checked,
   notify_replies:form.elements.notify_messages.checked,
   notify_follows:form.elements.notify_follows.checked,
   updated_at:new Date().toISOString()
  };
  if(isStarter&&avatars[avatar])profile.avatar_url=avatars[avatar];
  feedback("Saving your profile and privacy choices…");
  const saveProfile=await supabase.from("profiles").update(profile).eq("id",person.id).select("id").single();
  if(saveProfile.error)throw saveProfile.error;
  const onboarding={
    user_id:person.id,age_years:Number($("setupAge").value),gender:$("setupGender").value,
    interests:[...form.querySelectorAll('[name="interests"]:checked')].map(x=>x.value).slice(0,12),
    avatar_style:avatar==="male"||avatar==="female"?avatar:"neutral",
    completed_at:new Date().toISOString(),updated_at:new Date().toISOString()
  };
  feedback("Applying your personal settings…");
  await saveUserPreferences(person.id,{
    appearance:{theme:$("setupTheme").value,reduceMotion:form.elements.reduce_motion.checked},
    notifications:{messages:form.elements.notify_messages.checked,replies:form.elements.notify_messages.checked,
      follows:form.elements.notify_follows.checked,announcements:form.elements.notify_announcements.checked},
    privacy:{allowMessages:form.elements.allow_messages.checked,
      allowRequests:form.elements.allow_requests.checked,showEmail:false}
  });
  const saved=await supabase.from("member_onboarding").upsert(onboarding,{onConflict:"user_id"});
  if(saved.error)throw saved.error;
  const code=normalizeReferralCode($("setupReferralCode")?.value||"");
  if(referralsOpen && !$("setupReferralSection")?.hidden && validReferralCode(code)){
    try{await submitReferralCode(code);}catch(error){
      console.warn("Referral attribution deferred:",error?.message||"network");
    }
  }
  location.replace(nextTarget());
 }catch(error){console.error("Onboarding failed",error);feedback(error?.message||"We couldn't save your settings. Please try again.");}
 finally{saving=false;submit.disabled=false;submit.textContent="Start exploring ✨";form.setAttribute("aria-busy","false");}
});
async function boot(){
 person=await getCurrentUser();
 if(!person){location.replace("/login.html?next="+encodeURIComponent(location.pathname+location.search));return;}
 const [p,o]=await Promise.all([
  supabase.from("profiles").select("display_name,username,avatar_url").eq("id",person.id).maybeSingle(),
  supabase.from("member_onboarding").select("age_years,gender,interests,avatar_style,completed_at").eq("user_id",person.id).maybeSingle()
 ]);
 if(p.error||o.error){feedback("Could not load your account. Please refresh.");return;}
 existing=p.data||{};
 if(o.data?.completed_at){location.replace(nextTarget());return;}
 $("setupName").value=existing.display_name||person.user_metadata?.display_name||"";
 $("setupUsername").value=existing.username||person.user_metadata?.username||"";
 if(o.data?.age_years)$("setupAge").value=o.data.age_years;
 if(o.data?.gender)$("setupGender").value=o.data.gender;
 const avatar=o.data?.avatar_style||o.data?.gender;
 const radio=form.querySelector('input[name="avatar"][value="'+avatar+'"]');
 if(radio)radio.checked=true;
 syncStarterAvatar();
 captureReferralCode();
 await loadReferralOffer();
 for(const interest of o.data?.interests||[]){
  const target=[...form.querySelectorAll('[name="interests"]')].find(x=>x.value===interest);
  if(target)target.checked=true;
 }
 setStage(1);
}
void boot().catch(error=>{console.error(error);feedback("Unable to start account setup. Reload the page.");});
