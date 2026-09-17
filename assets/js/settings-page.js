import { supabase, getCurrentUser } from "./supabase.js";
import { loadUserPreferences, saveUserPreferences, mergePreferences, writeLocalPreferences } from "./user-preferences.js";
import { reportAppError } from "./utils.js";

const $ = (id) => document.getElementById(id);
const statusEl = $("settingsStatus");
let state = { user: null, preferences: null, profile: null, saving: false, timer: null };

function setStatus(message, tone = "") { if (statusEl) { statusEl.textContent = message; statusEl.dataset.tone = tone; } }
function getByPath(object,path,fallback=undefined){return String(path||"").split(".").filter(Boolean).reduce((value,key)=>value==null||!(key in value)?fallback:value[key],object);}
function setByPath(object,path,value){const parts=String(path||"").split(".").filter(Boolean);if(!parts.length)return;let target=object;parts.slice(0,-1).forEach((part)=>{if(!target[part]||typeof target[part]!=="object")target[part]={};target=target[part];});target[parts.at(-1)]=value;}
function controlValue(input){return input.type==="checkbox"?input.checked:input.value;}

function mountExtraSettings(){
  const content=document.querySelector(".settings-content");
  const nav=$("settingsNav");
  if(!content||!nav||$("security"))return;
  const addNav=(id,label)=>{const a=document.createElement("a");a.href=`#${id}`;a.textContent=label;nav.insertBefore(a,nav.querySelector('a[href="#cookies"]')||null);};
  addNav("appearance","Appearance & accessibility");
  addNav("security","Account security");

  const appearance=document.createElement("section");appearance.id="appearance";appearance.className="settings-card card";appearance.innerHTML=`<div class="settings-card-head"><div><span class="settings-kicker">Accessibility</span><h2>Appearance & accessibility</h2></div></div><div class="settings-stack"><label class="toggle-row"><span><strong>Reduce motion</strong><small>Reduce transitions and animations across Timzee.</small></span><input type="checkbox" data-path="appearance.reduceMotion"></label><label class="toggle-row"><span><strong>High contrast</strong><small>Strengthen boundaries and contrast for easier reading.</small></span><input type="checkbox" data-path="appearance.highContrast"></label></div>`;
  const security=document.createElement("section");security.id="security";security.className="settings-card card";security.innerHTML=`<div class="settings-card-head"><div><span class="settings-kicker">Security</span><h2>Account security</h2></div></div><div class="settings-stack"><div class="setting-row static"><div><strong>Password</strong><small>Request a secure password-reset email for this account.</small></div><button class="btn ghost sm" id="resetPasswordBtn" type="button">Reset password</button></div><div class="setting-row static"><div><strong>Current session</strong><small>Sign out this device immediately.</small></div><button class="btn ghost sm" id="signOutSettingsBtn" type="button">Sign out</button></div></div>`;
  const cookies=$("cookies");
  content.insertBefore(appearance,cookies); content.insertBefore(security,cookies);
  $("resetPasswordBtn")?.addEventListener("click",async()=>{try{const result=await supabase.auth.resetPasswordForEmail(state.user.email,{redirectTo:`${window.location.origin}/login.html`});if(result.error)throw result.error;setStatus("Password reset email requested.","success");}catch(error){setStatus(error?.message||"Could not request password reset.","error");reportAppError(error,"Password reset failed");}});
  $("signOutSettingsBtn")?.addEventListener("click",async()=>{try{await supabase.auth.signOut();window.location.href="login.html?next=settings.html";}catch(error){reportAppError(error,"Sign out failed");}});
}

function applyControls(){
  document.querySelectorAll("[data-path]").forEach((input)=>{const value=getByPath(state.preferences,input.dataset.path);if(input.type==="checkbox")input.checked=Boolean(value);else if(value!=null)input.value=String(value);});
  const profileMap={allow_messages:"allow_messages",allow_requests:"allow_requests",show_email:"show_email"};
  Object.entries(profileMap).forEach(([key,column])=>{const input=document.querySelector(`[data-profile-setting="${key}"]`);if(input)input.checked=Boolean(state.profile?.[column]);});
}

async function loadProfile(){
  const result=await supabase.from("profiles").select("allow_messages,allow_requests,show_email,notify_messages,notify_replies,notify_follows,notify_mentions").eq("id",state.user.id).maybeSingle();
  if(result.error)throw result.error;state.profile=result.data||{};
  const notificationMap={messages:"notify_messages",replies:"notify_replies",follows:"notify_follows",mentions:"notify_mentions"};
  Object.entries(notificationMap).forEach(([pref,column])=>{if(typeof state.profile[column]==="boolean")state.preferences.notifications[pref]=state.profile[column];});
}

async function saveAll(){
  if(!state.user||state.saving)return;state.saving=true;setStatus("Saving…");
  try{
    const profileUpdates={};
    document.querySelectorAll("[data-profile-setting]").forEach((input)=>{profileUpdates[input.dataset.profileSetting]=input.checked;});
    const notificationColumns={messages:"notify_messages",replies:"notify_replies",follows:"notify_follows",mentions:"notify_mentions"};
    Object.entries(notificationColumns).forEach(([pref,column])=>{profileUpdates[column]=Boolean(state.preferences.notifications[pref]);});
    const profileResult=await supabase.from("profiles").update(profileUpdates).eq("id",state.user.id);if(profileResult.error)throw profileResult.error;
    await saveUserPreferences(state.user.id,state.preferences);setStatus("Saved","success");
  }catch(error){setStatus(error?.message||"Could not save settings.","error");reportAppError(error,"Settings save failed");}finally{state.saving=false;}
}
function scheduleSave(){clearTimeout(state.timer);setStatus("Changes pending…");state.timer=window.setTimeout(()=>void saveAll(),500);}

function wireControls(){
  document.querySelectorAll("[data-path]").forEach((input)=>input.addEventListener("change",()=>{setByPath(state.preferences,input.dataset.path,controlValue(input));scheduleSave();}));
  document.querySelectorAll("[data-profile-setting]").forEach((input)=>input.addEventListener("change",scheduleSave));
  $("clearLocalDataBtn")?.addEventListener("click",()=>{writeLocalPreferences(state.user.id,mergePreferences());setStatus("Local preferences cleared. Server preferences remain saved.","success");});
  $("cookieSettingsBtn")?.addEventListener("click",()=>{if(typeof window.openCookieSettings==="function")window.openCookieSettings();else setStatus("Cookie settings are available from the privacy banner on this page.");});

  const nav=$("settingsNav");const links=[...(nav?.querySelectorAll("a")||[])];const sections=links.map((link)=>document.querySelector(link.getAttribute("href"))).filter(Boolean);
  if(links.length&&"IntersectionObserver" in window){const observer=new IntersectionObserver((entries)=>entries.forEach((entry)=>{const link=nav.querySelector(`a[href="#${entry.target.id}"]`);if(link&&entry.isIntersecting){links.forEach((item)=>item.classList.remove("active"));link.classList.add("active");}}),{rootMargin:"-20% 0px -65% 0px",threshold:0});sections.forEach((section)=>observer.observe(section));}
}

async function boot(){
  mountExtraSettings();
  state.user=await getCurrentUser();
  if(!state.user){setStatus("Sign in to save personal settings.");document.querySelectorAll("input,select,button[data-path]").forEach((control)=>{if(!control.closest("#cookies"))control.disabled=true;});return;}
  state.preferences=mergePreferences(await loadUserPreferences(state.user));
  await loadProfile();applyControls();wireControls();setStatus("Settings loaded","success");
}
boot().catch((error)=>{setStatus(error?.message||"Could not load settings.","error");reportAppError(error,"Settings page load failed");});
