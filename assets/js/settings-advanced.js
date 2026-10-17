import {supabase} from "./supabase.js";
import {DEFAULT_USER_PREFERENCES,mergePreferences} from "./user-preferences.js";

const topics=["AI & ML","Programming","Gadgets","Cybersecurity","Tech Jobs","Gaming","Startups","Learning","Technology","Project Showcase","Sports","Entertainment","World Affairs","General"];
const el=id=>document.getElementById(id);
const enumPaths={
  "appearance.theme":["system","light","dark"],
  "appearance.fontScale":["90","100","110","125"],
  "appearance.contentDensity":["comfortable","compact"],
  "discussion.defaultSort":["active","new","top","unanswered"]
};
function section(id,html){
 const parent=el(id);
 if(parent&&!parent.querySelector("[data-advanced]")){
   const wrapper=document.createElement("div");wrapper.dataset.advanced="yes";
   wrapper.innerHTML=html;parent.append(wrapper);
 }
}
function newNav(id,title){
 const nav=el("settingsNav");if(!nav||nav.querySelector('a[href="#'+id+'"]'))return;
 const a=document.createElement("a");a.href="#"+id;a.textContent=title;
 nav.insertBefore(a,nav.querySelector('a[href="#cookies"]'));
}
function note(id,message,error=false){
 const node=el(id);if(node){node.textContent=message;node.dataset.tone=error?"error":"success";}
}
async function confirmChange(message){
 return window.appUI?.confirm?Boolean(await window.appUI.confirm(message)):window.confirm(message);
}
function downloadJson(filename,object){
 const url=URL.createObjectURL(new Blob([JSON.stringify(object,null,2)],{type:"application/json"}));
 const link=document.createElement("a");link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();
 window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function validatePreferenceImport(payload){
 const raw=payload?.preferences&&typeof payload.preferences==="object"?payload.preferences:payload;
 if(!raw||typeof raw!=="object"||Array.isArray(raw))throw Error("Invalid preferences JSON.");
 const clean={};let values=0;
 function filter(base,input,output,prefix=""){
   if(!input||typeof input!=="object"||Array.isArray(input))return;
   for(const [key,defaultValue] of Object.entries(base)){
     if(!Object.prototype.hasOwnProperty.call(input,key))continue;
     const value=input[key],path=prefix?prefix+"."+key:key;
     if(typeof defaultValue==="object"&&defaultValue!==null&&!Array.isArray(defaultValue)){
       const nested={};filter(defaultValue,value,nested,path);
       if(Object.keys(nested).length)output[key]=nested;
     }else if(typeof value===typeof defaultValue){
       if(typeof value==="string"&&(value.length>70||enumPaths[path]&&!enumPaths[path].includes(value)))continue;
       output[key]=value;values++;
     }
   }
 }
 filter(DEFAULT_USER_PREFERENCES,raw,clean);
 if(!values)throw Error("No supported settings were found in this file.");
 return clean;
}
export function mountAdvancedSettings(){
 const parent=document.querySelector(".settings-content"),cookies=el("cookies");
 if(!parent||!cookies||el("advancedSettingsMarker"))return;
 const marker=document.createElement("span");marker.id="advancedSettingsMarker";marker.hidden=true;parent.prepend(marker);
 section("appearance",'<div class="settings-subheading"><h3>Display & reading comfort</h3><p>Applies on supported pages and syncs with your settings.</p></div>'+
 '<div class="settings-grid two"><label class="field"><span>Theme</span><select data-path="appearance.theme"><option value="system">Follow device</option><option value="light">Light</option><option value="dark">Dark</option></select></label>'+
 '<label class="field"><span>Text size</span><select data-path="appearance.fontScale"><option value="90">90% — Small</option><option value="100">100% — Standard</option><option value="110">110% — Larger</option><option value="125">125% — Extra large</option></select></label>'+
 '<label class="field"><span>Spacing</span><select data-path="appearance.contentDensity"><option value="comfortable">Comfortable</option><option value="compact">Compact</option></select></label></div>'+
 '<div class="settings-preview"><strong>Reading preview</strong><p>A comfortable reading experience for technology guides and longer conversations.</p></div>');
 section("privacy",'<div class="settings-subheading"><h3>Chat visibility</h3><p>Controls stored in your private chat settings, not only on this device.</p></div>'+
 '<div class="settings-stack"><label class="toggle-row"><span><strong>Read receipts</strong><small>Show your read status where supported in chat.</small></span><input type="checkbox" data-chat-privacy="read_receipts"></label>'+
 '<label class="toggle-row"><span><strong>Online presence</strong><small>Show when you are online on supported conversation screens.</small></span><input type="checkbox" data-chat-privacy="show_online"></label></div>');
 section("notifications",'<div class="settings-subheading"><h3>Additional in-app updates</h3></div>'+
 '<div class="settings-stack"><label class="toggle-row"><span><strong>Announcements</strong><small>Optional non-security platform announcements in supported interfaces.</small></span><input type="checkbox" data-path="notifications.announcements"></label>'+
 '<label class="toggle-row"><span><strong>Marketplace activity</strong><small>Listing and marketplace updates on supported interfaces.</small></span><input type="checkbox" data-path="notifications.marketplace"></label></div>');
 section("chat",'<div class="settings-subheading"><h3>Conversation sound</h3></div>'+
 '<label class="toggle-row"><span><strong>Chat sound effects</strong><small>Allow message sounds in chat screens that support this preference.</small></span><input type="checkbox" data-path="chat.sounds"></label>');
 const interests=document.createElement("section");interests.id="interests";interests.className="settings-card card";
 interests.innerHTML='<div class="settings-card-head"><div><span class="settings-kicker">Your technology</span><h2>Tech interests</h2></div><a class="btn ghost sm" href="discussion.html?mytech=1">My Tech feed</a></div>'+
 '<p class="settings-intro">Select topics for your personalized community recommendations. These interests are private to your account.</p>'+
 '<div class="settings-interest-toolbar"><span id="interestCount" aria-live="polite">Loading interests…</span><button type="button" class="btn ghost sm" id="clearInterestsBtn">Clear interests</button></div>'+
 '<div id="interestOptions" class="settings-interest-grid"></div><p id="interestStatus" class="settings-section-status" role="status" aria-live="polite"></p>';
 parent.insertBefore(interests,el("feed"));newNav("interests","Tech interests");
 const data=document.createElement("section");data.id="data-controls";data.className="settings-card card";
 data.innerHTML='<div class="settings-card-head"><div><span class="settings-kicker">Control your data</span><h2>Data & preferences</h2></div></div>'+
 '<p class="settings-intro">Export settings, restore preferences, and reset feed feedback. This is not a complete legal data portability export.</p>'+
 '<div class="settings-stack">'+
 '<div class="setting-row static"><div><strong>Download account settings snapshot</strong><small>Your profile settings, optional email choices, followed tech topics, community memberships and saved threads. Not a complete archive of every personal record.</small></div><button type="button" class="btn ghost sm" id="exportAccountSnapshotBtn">Download JSON</button></div>'+
 '<div class="setting-row static"><div><strong>Import preferences</strong><small>Restore supported UI preferences from a JSON file; account identity and privacy settings are not overwritten.</small></div><label for="importPreferencesFile" class="btn ghost sm">Choose file</label><input type="file" id="importPreferencesFile" class="settings-visually-hidden" accept=".json,application/json"></div>'+
 '<div class="setting-row static"><div><strong>Clear recommendation feedback</strong><small>Forget “Not interested” signals from the main feed and forums. This does not delete posts or account history.</small></div><button type="button" class="btn ghost sm" id="clearAllRecommendationsBtn">Clear feedback</button></div>'+
 '<div class="setting-row static"><div><strong>Account access or deletion requests</strong><small>Contact support for assistance. This link does not automatically delete your account.</small></div><a href="support.html" class="btn ghost sm">Contact support</a></div></div>'+
 '<p id="dataControlsStatus" class="settings-section-status" role="status" aria-live="polite"></p>';
 parent.insertBefore(data,cookies);newNav("data-controls","Data controls");
 const side=document.querySelector(".settings-sidebar-head");
 if(side&&!el("settingsSearch")){
  const block=document.createElement("div");block.className="settings-search-control";
  block.innerHTML='<label for="settingsSearch">Find a setting</label><input type="search" id="settingsSearch" placeholder="Privacy, video, security…" autocomplete="off" aria-describedby="settingsSearchCount"><small id="settingsSearchCount" role="status"></small>';
  side.append(block);
 }
 const sort=el("discussion")?.querySelector('[data-path="discussion.defaultSort"]');
 if(sort){
  sort.innerHTML='<option value="active">Most active</option><option value="new">Newest first</option><option value="top">Highest voted</option><option value="unanswered">Unanswered</option>';
  const title=sort.closest("label")?.querySelector("span");
  if(title)title.textContent="Default topic order";
 }
 const hero=document.querySelector(".settings-hero p");
 if(hero)hero.textContent="Choose how your account works. Saved preferences sync to your account where supported; browser storage is used for immediate display.";
}
export async function initializeAdvancedSettings({user,preferences,onImport,onStatus}){
 if(!user?.id)return;
 const uid=user.id,notify=(message,error=false)=>onStatus?.(message,error?"error":"success");
 const interestHost=el("interestOptions"),selected=new Set(),busy=new Set();
 const results=await supabase.from("community_user_interests").select("topic").eq("user_id",uid).limit(30);
 const loadFailed=Boolean(results.error);
 if(!loadFailed)for(const row of results.data||[])if(topics.includes(row.topic))selected.add(row.topic);
 const renderInterests=()=>{
  interestHost.replaceChildren();
  for(const topic of topics){
   const label=document.createElement("label");label.className="settings-interest-chip";
   const input=document.createElement("input");input.type="checkbox";input.value=topic;
   input.checked=selected.has(topic);input.disabled=loadFailed||busy.has(topic);
   const name=document.createElement("span");name.textContent=topic;label.append(input,name);interestHost.append(label);
   input.addEventListener("change",async()=>{
    const wanted=input.checked,previous=selected.has(topic);
    if(previous===wanted)return;
    input.disabled=true;busy.add(topic);
    try{
     const operation=wanted?supabase.from("community_user_interests").insert({user_id:uid,topic}):
       supabase.from("community_user_interests").delete().eq("user_id",uid).eq("topic",topic);
     const {error}=await operation;if(error)throw error;
     wanted?selected.add(topic):selected.delete(topic);
     note("interestStatus",topic+(wanted?" added to":" removed from")+" your interests.");
    }catch(error){input.checked=previous;note("interestStatus",error.message||"Couldn't save interest.",true);}
    finally{busy.delete(topic);input.disabled=false;el("interestCount").textContent=selected.size+" topics selected";}
   });
  }
  el("interestCount").textContent=selected.size+" topics selected";
 };
 renderInterests();
 if(loadFailed){
  note("interestStatus","Could not load interests. Refresh to retry.",true);
  el("clearInterestsBtn").disabled=true;
 }
 el("clearInterestsBtn").addEventListener("click",async()=>{
  if(!selected.size||busy.size||!await confirmChange("Clear all followed tech interests?"))return;
  const button=el("clearInterestsBtn");button.disabled=true;
  try{
   const {error}=await supabase.from("community_user_interests").delete().eq("user_id",uid);
   if(error)throw error;selected.clear();renderInterests();note("interestStatus","Interests cleared.");
  }catch(error){note("interestStatus",error.message,true);}finally{button.disabled=false;}
 });

 const privacy=await supabase.from("chat_privacy").select("read_receipts,show_online").eq("user_id",uid).maybeSingle();
 const privacyValues={read_receipts:privacy.data?.read_receipts!==false,show_online:privacy.data?.show_online!==false};
 document.querySelectorAll("[data-chat-privacy]").forEach(input=>{
  const key=input.dataset.chatPrivacy;input.checked=privacyValues[key];input.disabled=Boolean(privacy.error);
  input.addEventListener("change",async()=>{
   const previous=privacyValues[key],next=input.checked;input.disabled=true;
   const payload={...privacyValues,[key]:next};
   try{
    const {error}=await supabase.from("chat_privacy").upsert({
     user_id:uid,...payload,updated_at:new Date().toISOString()
    },{onConflict:"user_id"});
    if(error)throw error;Object.assign(privacyValues,payload);notify("Chat privacy saved.");
   }catch(error){input.checked=previous;notify(error.message||"Could not save privacy.",true);}
   finally{input.disabled=false;}
  });
 });
 if(privacy.error)notify("Chat privacy controls could not be loaded; other settings still work.",true);
 el("clearAllRecommendationsBtn").addEventListener("click",async()=>{
  if(!await confirmChange("Erase your Not interested feedback from feeds and community recommendations?"))return;
  const button=el("clearAllRecommendationsBtn");button.disabled=true;
  const failed=[];
  for(const table of ["user_content_feedback","community_feed_feedback"]){
   const {error}=await supabase.from(table).delete().eq("user_id",uid);
   if(error)failed.push(table);
  }
  button.disabled=false;
  note("dataControlsStatus",failed.length?"Could not clear: "+failed.join(", "):"Feedback cleared. Reload your feeds to see the change.",failed.length>0);
 });
 el("exportAccountSnapshotBtn").addEventListener("click",async()=>{
  const button=el("exportAccountSnapshotBtn");button.disabled=true;
  note("dataControlsStatus","Preparing account snapshot…");
  const requests=[
   ["profile",supabase.from("profiles").select("id,username,display_name,bio,headline,location,website,created_at,allow_messages,allow_requests,show_email").eq("id",uid).maybeSingle()],
   ["email_notifications",supabase.from("email_notification_preferences").select("message_digest,mention_digest,marketplace_alerts,community_digest,inactivity_reminders,updated_at").eq("user_id",uid).maybeSingle()],
   ["chat_privacy",supabase.from("chat_privacy").select("read_receipts,show_online,updated_at").eq("user_id",uid).maybeSingle()],
   ["community_interests",supabase.from("community_user_interests").select("topic,created_at").eq("user_id",uid).limit(100)],
   ["community_memberships",supabase.from("community_members").select("community_id,role,joined_at").eq("user_id",uid).limit(500)],
   ["saved_community_threads",supabase.from("community_saved_threads").select("thread_id,created_at").eq("user_id",uid).limit(500)]
  ];
  try{
   const results=await Promise.all(requests.map(([,query])=>query));
   const errors=results.map((value,i)=>value.error?requests[i][0]:null).filter(Boolean);
   if(errors.length)throw Error("Unable to include: "+errors.join(", ")+". Nothing downloaded.");
   const dataset=Object.fromEntries(results.map((value,i)=>[requests[i][0],value.data]));
   downloadJson("timzee-settings-"+new Date().toISOString().slice(0,10)+".json",{
    format:"timzee-settings-snapshot-v1",exported_at:new Date().toISOString(),
    scope:"Preferences and selected account settings, not a complete account data export.",
    max_rows_per_collection:500,preferences:mergePreferences(preferences),...dataset
   });
   note("dataControlsStatus","Settings snapshot downloaded. Store it privately.");
  }catch(error){note("dataControlsStatus",error.message||"Couldn't export snapshot.",true);}
  finally{button.disabled=false;}
 });
 el("importPreferencesFile").addEventListener("change",async event=>{
  const file=event.target.files?.[0];event.target.value="";if(!file)return;
  if(file.size>128*1024){note("dataControlsStatus","File must be under 128 KB.",true);return;}
  try{
   const changes=validatePreferenceImport(JSON.parse(await file.text()));
   if(!await confirmChange("Apply the settings found in this file to your account?"))return;
   onImport(changes);note("dataControlsStatus","Preferences imported and queued to save.");
  }catch(error){note("dataControlsStatus",error.message||"Import failed.",true);}
 });
 wireSearch();
}
function wireSearch(){
 const input=el("settingsSearch"),nav=el("settingsNav");
 if(!input||input.dataset.ready)return;input.dataset.ready="yes";
 const sections=[...document.querySelectorAll(".settings-content > section[id]")];
 const filter=()=>{
  const needle=input.value.trim().toLowerCase();let count=0;
  for(const section of sections){
   const matches=!needle||section.textContent.toLowerCase().includes(needle);
   section.hidden=!matches;if(matches)count++;
   const link=nav?.querySelector('a[href="#'+section.id+'"]');if(link)link.hidden=!matches;
  }
  el("settingsSearchCount").textContent=needle?count+" sections match":"";
 };
 input.addEventListener("input",filter);
 nav?.addEventListener("click",()=>{if(input.value){input.value="";filter();}});
}
