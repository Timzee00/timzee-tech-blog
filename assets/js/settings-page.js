import { supabase, getCurrentUser } from "./supabase.js";
import { loadUserPreferences, saveUserPreferences, mergePreferences, writeLocalPreferences, clearLocalPreferences } from "./user-preferences.js";
import { reportAppError } from "./utils.js";
import { mountAdvancedSettings, initializeAdvancedSettings } from "./settings-advanced.js";
import {forgetReadingEntry} from "./reader-journey.mjs";

const $ = (id) => document.getElementById(id);
const statusEl = $("settingsStatus");
let state = { user: null, preferences: null, profile: null, saving: false, timer: null, emailPreferences: null, emailSaving: false, emailDirty: false };
function setStatus(message,tone=""){if(statusEl){statusEl.setAttribute("role","status");statusEl.textContent=message;statusEl.dataset.tone=tone;}}
function getByPath(object,path,fallback=undefined){return String(path||"").split(".").filter(Boolean).reduce((value,key)=>value==null||!(key in value)?fallback:value[key],object);}
function setByPath(object,path,value){const parts=String(path||"").split(".").filter(Boolean);if(!parts.length)return;let target=object;parts.slice(0,-1).forEach(part=>{if(!target[part]||typeof target[part]!=="object")target[part]={};target=target[part];});target[parts.at(-1)]=value;}
function controlValue(input){return input.type==="checkbox"?input.checked:input.value;}

function mountExtraSettings(){
  const content=document.querySelector(".settings-content"),nav=$("settingsNav");if(!content||!nav||$("security"))return;
  const addNav=(id,label)=>{const a=document.createElement("a");a.href=`#${id}`;a.textContent=label;nav.insertBefore(a,nav.querySelector('a[href="#cookies"]')||null);};
  addNav("appearance","Appearance & accessibility");addNav("email","Email updates");addNav("security","Account security");
  const appearance=document.createElement("section");appearance.id="appearance";appearance.className="settings-card card";appearance.innerHTML=`<div class="settings-card-head"><div><span class="settings-kicker">Accessibility</span><h2>Appearance & accessibility</h2></div></div><div class="settings-stack"><label class="toggle-row"><span><strong>Reduce motion</strong><small>Reduce transitions and animations across Timzee.</small></span><input type="checkbox" data-path="appearance.reduceMotion"></label><label class="toggle-row"><span><strong>High contrast</strong><small>Strengthen boundaries and contrast for easier reading.</small></span><input type="checkbox" data-path="appearance.highContrast"></label></div>`;
  const security=document.createElement("section");security.id="security";security.className="settings-card card";security.innerHTML=`<div class="settings-card-head"><div><span class="settings-kicker">Security</span><h2>Account security</h2></div></div><div class="settings-stack"><div class="setting-row static"><div><strong>Password</strong><small>Request a secure password-reset email for this account.</small></div><button class="btn ghost sm" id="resetPasswordBtn" type="button">Reset password</button></div><div class="setting-row static"><div><strong>Current session</strong><small>Sign out this device immediately.</small></div><button class="btn ghost sm" id="signOutSettingsBtn" type="button">Sign out</button></div><div class="setting-row static"><div><strong>Change password</strong><small>Update your password securely without sending it to Timzee servers.</small></div><button class="btn ghost sm" id="changePasswordBtn" type="button">Change password</button></div><div class="setting-row static"><div><strong>All sessions</strong><small>Revoke other sessions and sign out this device.</small></div><button class="btn ghost sm" id="signOutAllBtn" type="button">Sign out everywhere</button></div><div class="setting-row static"><div><strong>Export preferences</strong><small>Save a local JSON copy of your current account preferences. This is not a complete account data export.</small></div><button class="btn ghost sm" id="exportPreferencesBtn" type="button">Export preferences</button></div></div>`;
  const email=document.createElement("section");email.id="email";email.className="settings-card card";
  email.innerHTML=`<div class="settings-card-head"><div><span class="settings-kicker">Email</span><h2>Optional email notifications</h2></div></div>
  <p class="settings-help">Email alerts are separate from in-app notifications. All optional email categories start switched off. Your choices will be saved now, but emails will only start after these features are released. Essential account/security messages are unaffected. Marketing mail requires separate consent. <a href="/newsletter.html">Subscribe to the newsletter separately</a>.</p>
  <div class="settings-stack">
  <label class="toggle-row"><span><strong>Message digest</strong><small>A grouped summary of unread messages instead of one email per chat.</small></span><input type="checkbox" data-email-notification="message_digest"></label>
  <label class="toggle-row"><span><strong>Mention digest</strong><small>Grouped mentions and discussion replies.</small></span><input type="checkbox" data-email-notification="mention_digest"></label>
  <label class="toggle-row"><span><strong>Marketplace updates</strong><small>Updates related to your marketplace activity, when available.</small></span><input type="checkbox" data-email-notification="marketplace_alerts"></label>
  <label class="toggle-row"><span><strong>Community digest</strong><small>Occasional updates from communities you follow, when available.</small></span><input type="checkbox" data-email-notification="community_digest"></label><label class="toggle-row"><span><strong>Reminder after a long absence</strong><small>Opt in to one email after 30 days without a visit. You can turn it off anytime.</small></span><input type="checkbox" data-email-notification="inactivity_reminders"></label>
  </div>`;
  const visitors=document.createElement("section");visitors.id="profile-visitor-privacy";
  visitors.className="settings-card card";
  visitors.innerHTML='<div class="settings-card-head"><div><span class="settings-kicker">Privacy</span><h2>Profile visits & visibility</h2></div></div>'+
   '<p class="settings-help">Profile visits are counted once per visitor per day and deleted after 30 days. Your name remains private unless you explicitly share it.</p>'+
   '<div class="settings-stack">'+
   '<label class="toggle-row"><span><strong>Profile visit notifications</strong><small>Receive a grouped in-app alert at most once daily.</small></span><input type="checkbox" data-path="notifications.profileViews"></label>'+
   '<label class="toggle-row"><span><strong>Count my visits</strong><small>When enabled, profiles you visit can count one anonymous visit per day. Disable for private browsing.</small></span><input type="checkbox" data-path="privacy.recordProfileVisits"></label>'+
   '<label class="toggle-row"><span><strong>Show my name to profiles I visit</strong><small>Off by default. Opt in to appear in their limited seven-day visitor insights.</small></span><input type="checkbox" data-path="privacy.shareProfileVisits"></label>'+
   '</div>';
  const reading=document.createElement("section");
  reading.id="reading-privacy";reading.className="settings-card card";
  reading.innerHTML='<div class="settings-card-head"><div><span class="settings-kicker">Your reading space</span><h2>Reading history & continuity</h2></div></div>'+
    '<p class="settings-help">Blipmood saves an approximate article completion percentage privately to your account so you can resume across devices. It is not visible on public profiles, and is not used to inflate post view counts.</p>'+
    '<div class="settings-stack">'+
    '<label class="toggle-row"><span><strong>Remember my reading progress</strong><small>Stop saving new reading progress anytime. Switching this off does not erase existing history.</small></span><input type="checkbox" data-path="privacy.rememberReading"></label>'+
    '<div class="setting-row"><div><strong>Erase my reading history</strong><small>Remove all recorded article positions from your account. Saved bookmarks remain unchanged.</small></div><button type="button" class="btn ghost sm" id="clearReadingHistoryBtn">Erase history</button></div>'+
    '</div><p class="settings-section-status" id="readingHistoryStatus" role="status" aria-live="polite"></p>';
  const cookies=$("cookies");content.insertBefore(appearance,cookies);content.insertBefore(email,cookies);content.insertBefore(visitors,cookies);content.insertBefore(reading,cookies);content.insertBefore(security,cookies);
  addNav("profile-visitor-privacy","Profile visit privacy");
  addNav("reading-privacy","Reading history");
  $("clearReadingHistoryBtn")?.addEventListener("click",async event=>{
    if(!state.user?.id)return;
    const approved=window.appUI?.confirm
      ? await window.appUI.confirm("Erase your private reading history from all devices? Your bookmarks will be kept.")
      : window.confirm("Erase your private reading history from all devices? Your bookmarks will be kept.");
    if(!approved)return;
    const button=event.currentTarget,notice=$("readingHistoryStatus");
    button.disabled=true;
    if(notice)notice.textContent="Erasing reading history…";
    try{
      await forgetReadingEntry(state.user.id);
      if(notice)notice.textContent="Your reading history is cleared. Saved articles are unchanged.";
    }catch(error){
      if(notice)notice.textContent="Could not erase history. Please retry.";
      reportAppError(error,"Clear reading history failed");
    }finally{button.disabled=false;}
  });
  $("resetPasswordBtn")?.addEventListener("click",async()=>{try{const result=await supabase.auth.resetPasswordForEmail(state.user.email,{redirectTo:`${window.location.origin}/login.html`});if(result.error)throw result.error;setStatus("Password reset email requested.","success");}catch(error){setStatus(error?.message||"Could not request password reset.","error");reportAppError(error,"Password reset failed");}});
  $("signOutSettingsBtn")?.addEventListener("click",async()=>{try{const result=await supabase.auth.signOut();if(result.error)throw result.error;window.location.href="login.html?next=settings.html";}catch(error){reportAppError(error,"Sign out failed");}});
  $("signOutAllBtn")?.addEventListener("click",async()=>{
    if(!await window.appUI.confirm("Sign out all your sessions on every device?"))return;
    try{const result=await supabase.auth.signOut({scope:"global"});if(result.error)throw result.error;window.location.replace("login.html?next=settings.html");}
    catch(error){setStatus(error.message||"Could not sign out all devices.","error");}
  });
  $("changePasswordBtn")?.addEventListener("click",async()=>{
    const password=await window.appUI.prompt("Enter a new password with at least 12 characters.",{
      title:"Change password",label:"New password",inputType:"password"
    });
    if(password===null)return;
    if(password.length<12 || password.length>128){setStatus("Use a password between 12 and 128 characters.","error");return;}
    const again=await window.appUI.prompt("Confirm the new password.",{title:"Confirm password",label:"Repeat new password",inputType:"password"});
    if(again===null)return;
    if(password!==again){setStatus("Passwords did not match.","error");return;}
    try{const result=await supabase.auth.updateUser({password});if(result.error)throw result.error;setStatus("Password updated. Other sessions may need to sign in again.","success");}
    catch(error){setStatus(error?.message||"Password update failed.","error");}
  });
  $("exportPreferencesBtn")?.addEventListener("click",()=>{
    if(!state.preferences)return;
    const exportBody=JSON.stringify({format:"timzee-preferences-v1",exported_at:new Date().toISOString(),preferences:state.preferences},null,2);
    const url=URL.createObjectURL(new Blob([exportBody],{type:"application/json"}));
    const link=document.createElement("a");
    link.href=url;link.download="timzee-preferences.json";document.body.append(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    setStatus("Preferences downloaded to this device.","success");
  });
}

const EMAIL_OPTION_KEYS=["message_digest","mention_digest","marketplace_alerts","community_digest","inactivity_reminders"];
async function loadEmailPreferences(){
  const result=await supabase.from("email_notification_preferences")
    .select("message_digest,mention_digest,marketplace_alerts,community_digest,inactivity_reminders")
    .eq("user_id",state.user.id).maybeSingle();
  if(result.error)throw result.error;
  state.emailPreferences=Object.fromEntries(EMAIL_OPTION_KEYS.map(key=>[key,result.data?.[key]===true]));
  document.querySelectorAll("[data-email-notification]").forEach(input=>{
    input.checked=state.emailPreferences[input.dataset.emailNotification]===true;
  });
}
async function saveEmailPreferences(){
  if(!state.user?.id || !state.emailPreferences)return;
  if(state.emailSaving){state.emailDirty=true;return;}
  state.emailSaving=true;
  try{
    do {
      state.emailDirty=false;
      setStatus("Saving email preferences…");
      const snapshot=Object.fromEntries(EMAIL_OPTION_KEYS.map(key=>[key,state.emailPreferences[key]===true]));
      const result=await supabase.from("email_notification_preferences").upsert({
        user_id:state.user.id,...snapshot,updated_at:new Date().toISOString()
      },{onConflict:"user_id"});
      if(result.error)throw result.error;
    } while(state.emailDirty);
    setStatus("Email preferences saved","success");
  }catch(error){
    setStatus("Could not save email choices. Change a setting to retry.","error");
    reportAppError(error,"Email preference save failed");
  }finally{state.emailSaving=false;}
}
function applyControls(){
  document.querySelectorAll("[data-path]").forEach(input=>{const value=getByPath(state.preferences,input.dataset.path);if(input.type==="checkbox")input.checked=Boolean(value);else if(value!=null)input.value=String(value);});
  const profileMap={allow_messages:"allow_messages",allow_requests:"allow_requests",show_email:"show_email"};Object.entries(profileMap).forEach(([key,column])=>{const input=document.querySelector(`[data-profile-setting="${key}"]`);if(input)input.checked=Boolean(state.profile?.[column]);});
}
async function loadProfile(){const result=await supabase.from("profiles").select("role,allow_messages,allow_requests,show_email,notify_messages,notify_replies,notify_follows,notify_mentions").eq("id",state.user.id).maybeSingle();if(result.error)throw result.error;state.profile=result.data||{};const map={messages:"notify_messages",replies:"notify_replies",follows:"notify_follows",mentions:"notify_mentions"};Object.entries(map).forEach(([pref,column])=>{if(typeof state.profile[column]==="boolean")state.preferences.notifications[pref]=state.profile[column];});}
function mountFounderDigestPreference(){
  if(state.profile?.role!=="super")return;
  const section=document.getElementById("notifications");
  const host=section?.querySelector(".settings-stack")||section;
  if(!host||host.querySelector('[data-path="notifications.operationsDigest"]'))return;
  const row=document.createElement("label");
  row.className="toggle-row";
  const copy=document.createElement("span");
  const title=document.createElement("strong");
  title.textContent="Founder daily operations summary";
  const help=document.createElement("small");
  help.textContent="Receive one in-app review digest per UTC day only when pending work exists. You can disable this at any time.";
  copy.append(title,help);
  const input=document.createElement("input");
  input.type="checkbox";
  input.dataset.path="notifications.operationsDigest";
  row.append(copy,input);
  host.append(row);
}
let dirty = false;
async function saveAll() {
  if (!state.user) return;
  if (state.saving) { dirty = true; return; }
  state.saving = true; dirty = false; setStatus("Saving…");
  const preferences = structuredClone(state.preferences);
  try {
    const updates = {};
    document.querySelectorAll("[data-profile-setting]").forEach(input => { updates[input.dataset.profileSetting] = input.checked; });
    const map = { messages: "notify_messages", replies: "notify_replies", follows: "notify_follows", mentions: "notify_mentions" };
    Object.entries(map).forEach(([pref, column]) => { updates[column] = Boolean(preferences.notifications[pref]); });
    const result = await supabase.from("profiles").update(updates).eq("id", state.user.id);
    if (result.error) throw result.error;
    await saveUserPreferences(state.user.id, preferences);
    setStatus(dirty ? "Saving your latest changes…" : "Saved", "success");
  } catch (error) {
    console.error("Settings save failed:", error);
    setStatus("Could not save. Your changes are still here. Change a setting to retry.", "error");
  } finally {
    state.saving = false;
    if (dirty) { clearTimeout(state.timer); void saveAll(); }
  }
}
function scheduleSave(){
 dirty=true;clearTimeout(state.timer);setStatus("Changes pending…");
 if(state.user?.id&&state.preferences)writeLocalPreferences(state.user.id,state.preferences);
 state.timer=window.setTimeout(()=>void saveAll(),500);
}

function wireRecommendationReset(){
  const feedSection=$("feed");if(!feedSection||$("manageRecommendationFeedbackBtn"))return;
  const help=feedSection.querySelector(".settings-help");if(!help)return;
  const row=document.createElement("div");row.className="settings-inline-actions";
  row.innerHTML='<a class="btn ghost sm" id="manageRecommendationFeedbackBtn" href="#data-controls">Manage recommendation feedback</a>';
  help.appendChild(row);
}

function wireControls(){
  document.querySelectorAll("[data-path]").forEach(input=>input.addEventListener("change",()=>{setByPath(state.preferences,input.dataset.path,controlValue(input));scheduleSave();}));
  document.querySelectorAll("[data-email-notification]").forEach(input=>input.addEventListener("change",()=>{
    if(!state.emailPreferences)return;
    state.emailPreferences[input.dataset.emailNotification]=input.checked;
    void saveEmailPreferences();
  }));
  document.querySelectorAll("[data-profile-setting]").forEach(input=>input.addEventListener("change",scheduleSave));
  wireRecommendationReset();
  $("clearLocalDataBtn")?.addEventListener("click",()=>{const cleared=clearLocalPreferences(state.user.id);setStatus(cleared?"This device’s preference cache was cleared. Your saved account settings remain unchanged; reload to sync them again.":"Unable to clear this device’s preference cache.",cleared?"success":"error");});
  const nav=$("settingsNav"),links=[...(nav?.querySelectorAll("a")||[])],sections=links.map(link=>document.querySelector(link.getAttribute("href"))).filter(Boolean);
  if(links.length&&"IntersectionObserver"in window){const observer=new IntersectionObserver(entries=>entries.forEach(entry=>{const link=nav.querySelector(`a[href="#${entry.target.id}"]`);if(link&&entry.isIntersecting){links.forEach(item=>item.classList.remove("active"));link.classList.add("active");}}),{rootMargin:"-20% 0px -65% 0px",threshold:0});sections.forEach(section=>observer.observe(section));}
}

async function boot() {
  mountExtraSettings();
  mountAdvancedSettings();
  $("cookieSettingsBtn")?.addEventListener("click", async () => {
    try {
      await import("./privacy-consent.js");
      if (!window.openCookieSettings) throw Error("Consent controls are unavailable");
      window.openCookieSettings();
    } catch(error) {
      setStatus("Cookie preferences could not open. Reload this page and retry.", "error");
      console.warn("Cookie preferences failed:",error);
    }
  });
  state.user = await getCurrentUser();
  if (!state.user) {
    setStatus("Sign in to save personal settings.");
    document.querySelectorAll(".settings-content input, .settings-content select, .settings-content button").forEach(control => { if (!control.closest("#cookies")) control.disabled = true; });
    const link = document.createElement("a"); link.className = "btn"; link.href = "/login.html?next=settings.html"; link.textContent = "Sign in to manage settings";
    document.querySelector(".settings-hero")?.append(link);
    return;
  }
  state.preferences = mergePreferences(await loadUserPreferences(state.user));
  await loadProfile(); mountFounderDigestPreference(); applyControls();
  try{await loadEmailPreferences();}
  catch(error){
    document.querySelectorAll("[data-email-notification]").forEach(input=>{input.disabled=true;});
    setStatus("Email preferences unavailable. Other settings can still be edited.","error");
    reportAppError(error,"Email preference loading failed");
  }
  wireControls();
  if(state.emailPreferences)setStatus("Settings loaded", "success");
  try{
    await initializeAdvancedSettings({
      user:state.user,
      preferences:state.preferences,
      getPreferences:()=>state.preferences,
      onStatus:(message,tone)=>setStatus(message,tone),
      onImport:changes=>{
        for(const [section,updates] of Object.entries(changes)){
          if(updates&&typeof updates==="object"&&!Array.isArray(updates)){
            state.preferences[section]={...state.preferences[section],...updates};
          }
        }
        state.preferences=mergePreferences(state.preferences);
        applyControls();scheduleSave();
      }
    });
  }catch(error){
    console.warn("Advanced preferences unavailable:",error);
    setStatus("Some advanced settings could not load. Your standard settings remain available.","error");
  }
}
boot().catch(error=>{setStatus(error?.message||"Could not load settings.","error");reportAppError(error,"Settings page load failed");});
