import { createChatRealtime } from "./chat-realtime.mjs";
import { setupChatEnhancements } from "./chat-enhancements.mjs";
import {openPollComposer,mountPoll} from "./content-polls.mjs";
import {setupMentionInput} from "./mentions.js";
import {renderChatText} from "./chat-rich-format.mjs";
import {translateVerifiedText} from "./chat-translator.mjs";
import {verifiedName,verifiedAvatar,verifiedLevel,verifiedFrameClasses} from "./verified-identity.mjs";
import { voicePlayerHtml,setupChatVoicePlayers } from "./chat-voice-player.mjs";
import { bindSearch } from "./search-input.js";
import { fetchMessagePage } from "./chat-history.mjs";
import { loadLatestThreadPreviews } from "./chat-previews.mjs";
import { supabase, getCurrentUserWithRole, getDisplayName } from "./supabase.js";
import { uploadMedia } from "./media.js";
import { getChatMediaPath } from "./chat-media-path.mjs";
import { loadUserPreferences, saveUserPreferences } from "./user-preferences.js";
import { escapeHTML, isSafeUrl, timeAgo, reportAppError } from "./utils.js";
import { submitModerationReport } from "./moderation-reports.mjs";

const DEFAULT_AVATAR = "/assets/img/avatar-placeholder.svg";
const DEFAULT_GROUP_AVATAR = "/assets/img/group-placeholder.svg";
const SETTINGS_KEY = "timzee_chat_settings_v2";
const DEFAULT_SETTINGS = { notifications: true, enterToSend: true, compact: false, autoTranslate:false,translateLanguage:"en",fontSize:"1",wallpaper:"default" };
const IMAGE_EXTENSIONS = new Set(["jpg","jpeg","png","gif","webp","bmp","svg","avif","heic","heif"]);
const VIDEO_EXTENSIONS = new Set(["mp4","webm","mov","m4v","mkv","avi","wmv","flv","3gp"]);
const AUDIO_EXTENSIONS = new Set(["mp3","wav","ogg","m4a","aac","flac","opus","webm"]);

const state = {
  selection: 0, loadingThread: false, historyCursor: null, hasOlderMessages: false, loadingHistory: false, sending: false, editing: null, editSaving: false, replyTo: null, reactions:new Map(), reactionBusy:new Set(),
  drafts: new Map(), previews: new Map(), previewsLoading: false, chatListGeneration: 0, peopleResults: [], peopleRequest: 0, messageVersions: new Map(), messageRevision: 0,
  user: null, verified:false, translations:new Map(), translationBusy:new Set(), starred:new Set(),forwardingMessageId:null,settings: { ...DEFAULT_SETTINGS }, friends: [], friendProfiles: new Map(), friendships: [], requests: [], sentRequests: [], blocked: [], directPartners: [], staffDMAllowed: false, canCompose: true,
  blockedProfiles: new Map(), groups: [], groupMembers: new Map(), personalViews: new Map(), messages: [], pinnedMessages: [], activeThreadId: "", activeFriendId: "", activeGroupId: "",
  searchTerm: "", peopleTerm: "", messageSearchTerm: "", mediaFile: null, mediaType: "", previewUrl: "",
  recorder: null, recorderStream: null, recorderChunks: [], recorderTimer: null, recorderStartedAt: 0, analyserFrame: 0, audioContext: null, analyser: null, recordingStarting: false, recordingRequestId: 0
};

const $ = (id) => document.getElementById(id);
let groupRestrictionTimer=null;
let previousGroupRestrictionMode=null;
// Postgres direct_messages.created_at is UTC timestamp WITHOUT TIME ZONE.
// PostgREST returns a timezone-less string, which JS otherwise treats as local.
function asUtcTimestamp(input){
  const value=String(input||"");
  if(!value)return "";
  const normalized=value.replace(" ","T");
  return /(?:Z|[+-]\d\d(?::?\d\d)?)$/i.test(normalized)?normalized:normalized+"Z";
}
const chatTimeAgo=value=>timeAgo(asUtcTimestamp(value));
const chatEnhancements=setupChatEnhancements({
  supabase,
  onPresence:(label,active)=>{
    state.peerPresenceLabel=label;
    if(!state.activeThreadId)return;
    if(['connecting','reconnecting','offline'].includes(state.connectionStatus))return;
    setHeaderStatus(label,active);
  }
});

function getFileExtension(value = "") {
  const cleaned = String(value || "").split("?")[0].split("#")[0];
  const segment = cleaned.split("/").pop() || "";
  const parts = segment.split(".");
  return parts.length > 1 ? parts.pop().toLowerCase() : "";
}
function getMediaTypeFromMime(mimeType = "") {
  const normalized = String(mimeType || "").toLowerCase();
  if (!normalized) return "";
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("video/")) return "video";
  if (normalized.startsWith("audio/")) return "audio";
  return "file";
}
function resolveAttachmentType({ mediaType = "", mimeType = "", fileName = "", mediaUrl = "" } = {}) {
  const normalized = String(mediaType || "").toLowerCase();
  if (["image", "video", "audio", "file"].includes(normalized)) return normalized;
  const mime = getMediaTypeFromMime(mimeType);
  if (mime) return mime;
  const ext = getFileExtension(fileName || mediaUrl);
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  return "file";
}
function formatFileSize(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes, index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${index === 0 || value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}
function getDisplayFileName(value = "") {
  const cleaned = String(value || "Attachment").split("?")[0].split("#")[0];
  try { return decodeURIComponent(cleaned.split("/").pop() || "Attachment"); } catch (_) { return cleaned.split("/").pop() || "Attachment"; }
}
function readSettings() {
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
  catch (_) { return { ...DEFAULT_SETTINGS }; }
}
let settingsSaving = false;
let settingsDirty = false;
function applySettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (_) {}
  document.documentElement.dataset.chatCompact = String(state.settings.compact === true);
  const validWallpapers=["default","linen","dark","forest","oxblood","aurora","platinum"];
  let wallpaper=validWallpapers.includes(state.settings.wallpaper)?state.settings.wallpaper:"default";
  if(!state.verified&&["aurora","platinum"].includes(wallpaper))wallpaper="default";
  const size=Number(state.settings.fontSize);
  const safeSize=[.75,.875,1,1.125,1.25].includes(size)?size:1;
  document.documentElement.dataset.chatWallpaper=wallpaper;
  document.documentElement.style.setProperty("--timzee-chat-message-scale",String(safeSize));
  if($("chatWallpaper"))$("chatWallpaper").value=wallpaper;
  if($("chatTextSize"))$("chatTextSize").value=String(safeSize);
  document.querySelectorAll("[data-chat-premium]").forEach(option=>{
    option.disabled=!state.verified;
    option.hidden=!state.verified;
  });
  defaultSettingsUI();
}
async function saveSettings() {
  applySettings(); settingsDirty = true;
  if (settingsSaving || !state.user) return;
  settingsSaving = true;
  const status = $("chatSettingsStatus");
  try {
    while (settingsDirty) {
      settingsDirty = false;
      if (status) status.textContent = "Saving…";
      await saveUserPreferences(state.user.id, { chat: { ...state.settings } });
    }
    if (status) status.textContent = "Saved";
  } catch (error) {
    if (status) status.textContent = "Could not sync. Change a setting to retry.";
    console.error("Chat settings save failed:", error);
  } finally {
    settingsSaving = false;
    if (settingsDirty) void saveSettings();
  }
}
function defaultSettingsUI() { document.querySelectorAll("[data-chat-setting]").forEach((input) => { input.checked = Boolean(state.settings[input.dataset.chatSetting]); }); }
function setView(view) {
  if (view !== 'chat' && view !== 'info') { stopRecording(false); clearMediaPreview(); }
  const layout = $("chatLayout"); if (layout) layout.dataset.view = view;
  if ($("chatConversation")) $("chatConversation").hidden = view === "list" || view === "info";
  if ($("chatEmptyState")) $("chatEmptyState").hidden = view !== "list";
}
function setHeaderStatus(text, live = false) { if ($("chatStatusText")) $("chatStatusText").textContent = text; if ($("chatLiveDot")) $("chatLiveDot").classList.toggle("is-live", live); }
function closeHeaderMenu() { const menu=$("chatHeaderMenu"); if(menu)menu.hidden=true; $("chatMenuToggle")?.setAttribute("aria-expanded","false"); }
function openHeaderMenu() {
  const menu=$("chatHeaderMenu");
  if(!menu)return;
  menu.querySelector('[data-chat-menu="poll"]').hidden=!Boolean(state.activeGroupId);
  menu.querySelector('[data-chat-menu="pin"]').hidden=!Boolean(state.activeGroupId);
  menu.querySelector('[data-chat-menu="mute"]').textContent=isCurrentChatMuted()?'Unmute notifications':'Mute notifications';
  menu.querySelector('[data-chat-menu="archive"]').textContent=isArchived(state.activeThreadId)?'Unarchive chat':'Archive and mute chat';
  menu.hidden=false;
  $("chatMenuToggle")?.setAttribute("aria-expanded","true");
}
function profileFor(id) { return state.friendProfiles.get(id) || state.blockedProfiles.get(id) || null; }
// Prefer public usernames, then a legacy public display name. Never use emails
// or internal account IDs as invented names.
function chatProfileLabel(profile) {
  const name=String(profile?.username||profile?.display_name||profile?.full_name||'').trim();
  return name.slice(0,80)||'Unknown user';
}
function threadForFriend(id) { return [state.user.id,id].sort().join("_"); }
function activeGroup() { return state.groups.find((g)=>g.id===state.activeGroupId) || null; }
function isOwnerOfActiveGroup() { return Boolean(state.activeGroupId && activeGroup()?.created_by===state.user?.id); }
function viewFor(threadId){return state.personalViews.get(threadId)||null;}
function isArchived(threadId){return viewFor(threadId)?.archived===true;}
function isMuted(threadId){
  const own=viewFor(threadId);
  if(own)return own.muted===true||own.archived===true;
  return Boolean(state.groups.find(group=>group.id===threadId)?.is_muted);
}
function isCurrentChatMuted(){return isMuted(state.activeThreadId);}
async function setPersonalChatView({archived=null,muted=null,clear=false}={}){
  const threadId=state.activeThreadId;
  if(!threadId||!state.user?.id)throw Error('Open a conversation first.');
  const {data,error}=await supabase.rpc('set_chat_personal_view',{
    p_thread_id:threadId,p_archived:archived,
    p_muted:muted===null&&!viewFor(threadId)&&activeGroup()?.is_muted===true?true:muted,
    p_clear:clear
  });
  if(error)throw error;
  if(!data||data.thread_id!==threadId)throw Error('Chat preferences could not be saved.');
  state.personalViews.set(threadId,data);
  if(clear){
    // The SQL restrictive SELECT policy also hides previously cleared messages
    // from direct queries and history pagination for this user alone.
    state.messages=[];state.pinnedMessages=[];state.starred.clear();state.reactions.clear();
    state.historyCursor=null;state.hasOlderMessages=false;
    $("loadOlderMessages").hidden=true;
    state.previews.delete(threadId);
    renderPinnedMessages();renderMessages();renderInfoMedia();
  }
  renderFriends();renderGroups();
  return data;
}
async function clearCurrentChat(){
  const name=activeGroup()?.name||(state.activeFriendId?chatProfileLabel(profileFor(state.activeFriendId)):'this conversation');
  if(!await window.appUI.confirm('Clear '+name+' only for your account? This hides all previous messages for you, not for the other person or group members. This cannot be undone.'))return;
  await setPersonalChatView({clear:true});
  window.siteToast?.('Chat cleared for you only. Other participants keep their history.',{type:'success'});
}
async function toggleCurrentArchive(){
  const next=!isArchived(state.activeThreadId);
  await setPersonalChatView({archived:next,muted:next?true:null});
  window.siteToast?.(next?'Chat archived and notifications muted.':'Chat moved out of Archived. Notifications remain muted until you unmute them.',{type:'success'});
  if(next){
    leaveConversation();
    document.querySelector('.chat-tab[data-tab="archived"]')?.click();
  }
}


async function reportActiveConversation(){
  if(!state.user?.id)throw Error("Sign in to submit reports.");
  const group=activeGroup();
  const subject=group ? "group" : "user";
  const contentId=group?.id || state.activeFriendId;
  if(!contentId)throw Error("Open a private chat or group before reporting.");
  const reason=await window.appUI.prompt("Explain why you are reporting this "+subject+" (at least 8 characters):","");
  if(reason===null)return;
  await submitModerationReport({
    reporterId:state.user.id,contentType:group?"chat_group":"user",contentId,reason,
    metadata:group?{}:{threadId:state.activeThreadId}
  });
  window.siteToast?.("Report submitted for moderator review.",{type:"success",title:"Report sent"});
}
async function loadProfiles(ids) {
  const unique=[...new Set(ids.filter(Boolean))]; if(!unique.length)return;
  const result=await supabase.from("public_profiles").select("*").in("id",unique); if(result.error)throw result.error;
  (result.data||[]).forEach((p)=>state.friendProfiles.set(p.id,p));
}
async function loadAllChatData({deferPreviews=false}={}) {
  const generation=++state.chatListGeneration;
  const userId=state.user.id;
  // Independent requests can run together; prior startup waited for each
  // network round-trip before beginning the next one.
  const [saved,fr,gr,history]=await Promise.all([
    supabase.from("chat_personal_views")
      .select("thread_id,archived,muted,cleared_before,updated_at").eq("user_id",userId),
    supabase.from("friendships").select("*")
      .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`),
    supabase.from("chat_members")
      .select("thread_id,tags,is_muted,is_pinned,chat_threads(id,name,is_group,created_by,created_at,avatar_url,description,settings,updated_at)")
      .eq("user_id",userId),
    supabase.from("direct_messages")
      .select("sender_id,recipient_id,created_at")
      .or(`sender_id.eq.${userId},recipient_id.eq.${userId}`)
      .not("recipient_id","is",null)
      .order("created_at",{ascending:false}).limit(250)
  ]);
  for(const response of [saved,fr,gr,history])if(response.error)throw response.error;
  if(generation!==state.chatListGeneration)return;
  state.personalViews=new Map((saved.data||[]).map(view=>[view.thread_id,view]));
  state.friendships=fr.data||[];
  state.requests=state.friendships.filter(r=>r.status==='pending'&&r.addressee_id===userId);
  state.sentRequests=state.friendships.filter(r=>r.status==='pending'&&r.requester_id===userId);
  state.friends=state.friendships.filter(r=>r.status==='accepted')
    .map(r=>r.requester_id===userId?r.addressee_id:r.requester_id);
  state.blocked=state.friendships.filter(r=>r.status==='blocked'&&r.blocked_by===userId)
    .map(r=>r.requester_id===userId?r.addressee_id:r.requester_id);
  state.groups=(gr.data||[]).map(r=>({
    ...(r.chat_threads||{}),member_tags:r.tags||[],
    is_muted:r.is_muted,is_pinned:r.is_pinned
  })).filter(g=>g.id&&g.is_group);
  const blockedPairs=new Set(state.friendships.filter(f=>f.status==="blocked")
    .map(f=>f.requester_id===userId?f.addressee_id:f.requester_id));
  const savedPartners=[...state.personalViews.keys()]
    .filter(id=>id.includes("_"))
    .map(id=>id.split("_").find(part=>part!==userId));
  state.directPartners=[...new Set([
    ...(history.data||[]).map(m=>m.sender_id===userId?m.recipient_id:m.sender_id),
    ...savedPartners
  ])].filter(id=>id&&id!==userId&&!blockedPairs.has(id));

  const ids=[...state.friends,...state.directPartners,
    ...state.requests.map(r=>r.requester_id),...state.sentRequests.map(r=>r.addressee_id),
    ...state.blocked];
  const threadIds=[
    ...[...new Set([...state.friends,...state.directPartners])].map(threadForFriend),
    ...state.groups.map(g=>g.id)
  ];
  const profiles=loadProfiles(ids);
  if(deferPreviews){
    state.previewsLoading=true;
    state.previews=new Map();
    const previewRequest=loadThreadPreviews(threadIds);
    void Promise.all([profiles,previewRequest]).then(([,previews])=>{
      if(generation!==state.chatListGeneration)return;
      state.previews=previews;state.previewsLoading=false;
      renderFriends();renderGroups();
    }).catch(error=>{
      if(generation!==state.chatListGeneration)return;
      state.previewsLoading=false;
      console.warn("Chat previews will refresh when conversations are opened:",error);
      renderFriends();renderGroups();
    });
    await profiles;
  }else{
    const [,previews]=await Promise.all([profiles,loadThreadPreviews(threadIds)]);
    if(generation!==state.chatListGeneration)return;
    state.previews=previews;state.previewsLoading=false;
  }
}
async function loadThreadPreviews(threadIds = []) {
  // One preview per thread, never an unbounded download of complete histories.
  return loadLatestThreadPreviews(supabase, threadIds);
}

function renderFriends() {
  const target=$("dmsList"); if(!target)return;
  const previewMap=state.previews;
  const rows=[...new Set([...state.friends,...state.directPartners])].map(friendId=>({friendId,profile:profileFor(friendId)||{},preview:previewMap.get(threadForFriend(friendId))||null}));
  const q=state.searchTerm.trim().toLowerCase();
  const filtered=rows.filter(({friendId,profile})=>!isArchived(threadForFriend(friendId))&&(!q||[profile.username,profile.display_name].some(v=>String(v||"").toLowerCase().includes(q)))).sort((a,b)=>new Date(b.preview?.created_at||0)-new Date(a.preview?.created_at||0));
  target.innerHTML=filtered.length?filtered.map(({friendId,profile,preview})=>`<button class="chat-list-row ${friendId===state.activeFriendId?'active':''}" type="button" data-friend-id="${friendId}">${verifiedAvatar(profile.avatar_url||DEFAULT_AVATAR,profile,{size:"md"})}<span class="chat-list-copy"><strong>${verifiedName(chatProfileLabel(profile),profile,{compact:true})}${["super","admin","moderator"].includes(profile.role)?' <span class="chat-staff-label">Staff</span>':''}</strong><small>${escapeHTML(preview?.body||(preview?.media_type?`Sent ${preview.media_type}`:'Start a conversation'))}</small></span><span class="chat-list-time">${preview?chatTimeAgo(preview.created_at):''}</span></button>`).join(''):`<div class="callout">${q?'No matching chats.':'No friends yet. Use Find people to connect.'}</div>`;
  renderUnifiedInbox();
  renderArchived();
}
function renderGroups() { const badge=$("groupsBadge");if(badge){
  // Group membership is not an unread message count. Never display it as one.
  badge.textContent='';badge.hidden=true;
}
  const target=$("groupList"); if(!target)return; const q=state.searchTerm.trim().toLowerCase();
  const groups=state.groups.filter(g=>!isArchived(g.id)&&(!q||String(g.name||'').toLowerCase().includes(q))).sort((a,b)=>Number(b.is_pinned)-Number(a.is_pinned)||new Date(b.updated_at||b.created_at)-new Date(a.updated_at||a.created_at));
  target.innerHTML=groups.length?groups.map(g=>`<button class="chat-list-row ${g.id===state.activeGroupId?'active':''}" type="button" data-group-id="${g.id}"><img class="chat-list-avatar" src="${escapeHTML(g.avatar_url||DEFAULT_GROUP_AVATAR)}" alt=""><span class="chat-list-copy"><strong>${escapeHTML(g.name||'Group')}</strong><small>${escapeHTML(state.previews.get(g.id)?.body||(state.previews.get(g.id)?.media_type?`Sent ${state.previews.get(g.id).media_type}`:g.description||'Group chat'))}</small></span><span class="chat-list-time">${state.previews.get(g.id)?chatTimeAgo(state.previews.get(g.id).created_at):''}${g.is_pinned?'<span class="chat-row-pin" aria-label="Pinned chat">◆</span>':''}</span></button>`).join(''):`<div class="callout">No groups yet. Create one to get started.</div>`;
  renderUnifiedInbox();
  renderArchived();
}


function renderUnifiedInbox(){
 const target=$("friendList");if(!target||!state.user)return;
 const q=state.searchTerm.trim().toLowerCase();
 const dms=[...new Set([...state.friends,...state.directPartners])].map(id=>{
  const profile=profileFor(id)||{},threadId=threadForFriend(id);
  return {id,threadId,type:'dm',title:chatProfileLabel(profile),
   profile,preview:state.previews.get(threadId)||null, pinned:false};
 }).filter(item=>!isArchived(item.threadId));
 const groups=state.groups.filter(g=>!isArchived(g.id)).map(g=>({
  id:g.id,threadId:g.id,type:'group',title:g.name||'Group',
  group:g,preview:state.previews.get(g.id)||null,pinned:g.is_pinned===true
 }));
 const all=[...dms,...groups].filter(item=>!q||
   [item.title,item.type==='group'?item.group?.description:'',item.preview?.body]
     .some(part=>String(part||'').toLowerCase().includes(q)));
 all.sort((a,b)=>Number(b.pinned)-Number(a.pinned)||
   new Date(asUtcTimestamp(b.preview?.created_at||b.group?.updated_at||b.group?.created_at)||0)-
   new Date(asUtcTimestamp(a.preview?.created_at||a.group?.updated_at||a.group?.created_at)||0));
 target.innerHTML=all.length?all.map(item=>{
  const active=item.type==='group'?item.id===state.activeGroupId:item.id===state.activeFriendId;
  const icon=item.type==='group'?
   '<img class="chat-list-avatar" src="'+escapeHTML(item.group.avatar_url||DEFAULT_GROUP_AVATAR)+'" alt="">':
   verifiedAvatar(item.profile.avatar_url||DEFAULT_AVATAR,item.profile,{size:"md"});
  const label=item.type==='group'?escapeHTML(item.title):
   verifiedName(item.title,item.profile,{compact:true});
  const excerpt=String(item.preview?.body||(
    !item.preview&&state.previewsLoading?'Loading latest message…':
    item.preview?.media_type?'Sent '+item.preview.media_type:
    item.type==='group'?item.group?.description||'Group chat':'Start a conversation')).slice(0,120);
  const when=item.preview?chatTimeAgo(item.preview.created_at):'';
  return '<button class="chat-list-row '+(active?'active':'')+'" type="button" data-'+
   (item.type==='group'?'group-id':'friend-id')+'="'+escapeHTML(item.id)+'">'+
   icon+'<span class="chat-list-copy"><strong>'+label+'</strong><small>'+
   escapeHTML(excerpt)+'</small></span><span class="chat-list-time">'+escapeHTML(when)+
   (item.pinned?'<span class="chat-row-pin" title="Pinned">◆</span>':'')+
   '</span></button>';
 }).join(''):'<div class="callout">'+
  (q?'No matching conversations.':'No chats yet. Find people or create a group to get started.')+'</div>';
}
function renderArchived(){
  const target=$("archivedList"),badge=$("archivedBadge");
  if(!target)return;
  const q=state.searchTerm.trim().toLowerCase(),rows=[];
  for(const friendId of new Set([...state.friends,...state.directPartners])){
    const threadId=threadForFriend(friendId);
    if(!isArchived(threadId))continue;
    const p=profileFor(friendId)||{};
    const label=chatProfileLabel(p);
    rows.push({id:friendId,kind:'friend',label,photo:p.avatar_url||DEFAULT_AVATAR,muted:isMuted(threadId)});
  }
  for(const group of state.groups){
    if(!isArchived(group.id))continue;
    rows.push({id:group.id,kind:'group',label:group.name||'Group',photo:group.avatar_url||DEFAULT_GROUP_AVATAR,muted:isMuted(group.id)});
  }
  if(badge){badge.textContent=String(rows.length);badge.hidden=!rows.length;}
  const visible=rows.filter(row=>!q||row.label.toLowerCase().includes(q));
  target.innerHTML=visible.length?visible.map(row=>
    '<button class="chat-list-row" type="button" data-'+(row.kind==='group'?'group-id':'friend-id')+'="'+escapeHTML(row.id)+'">'+
    '<img class="chat-list-avatar" src="'+escapeHTML(row.photo)+'" alt="">'+
    '<span class="chat-list-copy"><strong>'+escapeHTML(row.label)+'</strong><small>'+ (row.muted?'Notifications muted':'Archived')+'</small></span></button>'
  ).join(''):'<div class="callout">'+(q?'No matching archived chats.':'No archived conversations yet.')+'</div>';
}
function renderRequests() {
  const incoming=$("friendRequests"),outgoing=$("friendRequestsSent"),badge=$("requestsBadge"); if(badge){badge.textContent=String(state.requests.length);badge.hidden=!state.requests.length;}
  const name=id=>verifiedName(chatProfileLabel(profileFor(id)),profileFor(id),{compact:true});
  if(incoming)incoming.innerHTML=state.requests.length?state.requests.map(r=>`<div class="chat-request-row">${verifiedAvatar(profileFor(r.requester_id)?.avatar_url||DEFAULT_AVATAR,profileFor(r.requester_id),{size:"sm"})}<div><strong>${name(r.requester_id)}</strong><small>Friend request</small></div><div class="inline-actions"><button class="btn sm" data-request="accept" data-id="${r.id}">Accept</button><button class="btn ghost sm" data-request="decline" data-id="${r.id}">Decline</button></div></div>`).join(''):`<div class="callout">No incoming requests.</div>`;
  if(outgoing)outgoing.innerHTML=state.sentRequests.length?state.sentRequests.map(r=>`<div class="chat-request-row">${verifiedAvatar(profileFor(r.addressee_id)?.avatar_url||DEFAULT_AVATAR,profileFor(r.addressee_id),{size:"sm"})}<div><strong>${name(r.addressee_id)}</strong><small>Request sent</small></div><button class="btn ghost sm" data-request="cancel" data-id="${r.id}">Cancel</button></div>`).join(''):`<div class="callout">No outgoing requests.</div>`;
}
function renderBlocked() { const badge=$("blockedBadge");if(badge){badge.textContent=String(state.blocked.length);badge.hidden=!state.blocked.length;} if($("chatBlockedFooterCount"))$("chatBlockedFooterCount").textContent=state.blocked.length?"("+state.blocked.length+")":""; const target=$("blockedList"); if(!target)return; target.innerHTML=state.blocked.length?state.blocked.map(id=>`<div class="chat-request-row">${verifiedAvatar(profileFor(id)?.avatar_url||DEFAULT_AVATAR,profileFor(id),{size:"sm",alt:""})}<div><strong>${escapeHTML(chatProfileLabel(profileFor(id)))}</strong><small>Blocked</small></div><button class="btn ghost sm" data-unblock="${id}">Unblock</button></div>`).join(''):`<div class="callout">No blocked users.</div>`; }
function renderPeopleResults() {
  const target=$("peopleResults"); if(!target)return;
  const q=state.peopleTerm.trim().toLowerCase();
  if(q.length<2){
    target.innerHTML='<div class="callout">Search by name or username (at least 2 characters).</div>';
    return;
  }
  target.innerHTML=state.peopleResults.length
   ? state.peopleResults.slice(0,20).map(p=>{
       const rel=state.friendships.find(r=>
         (r.requester_id===state.user.id&&r.addressee_id===p.id)||
         (r.addressee_id===state.user.id&&r.requester_id===p.id));
       const friend=rel?.status==="accepted",pending=rel?.status==="pending",blocked=rel?.status==="blocked";
       const alreadyMessaging=state.directPartners.includes(p.id);
       const canMessage=!blocked&&p.allow_messages!==false&&
         (friend||state.staffDMAllowed||alreadyMessaging);
       const message=canMessage?'<button class="btn sm" data-people-action="message" data-id="'+p.id+'">'+
         (friend||alreadyMessaging?"Message":"Message as staff")+'</button>':"";
       const request=blocked?'<span class="chip">Blocked</span>':
         pending?'<span class="chip">Request pending</span>':
         friend?'':p.allow_requests===false?'<span class="chip">Requests closed</span>':
           '<button class="btn ghost sm" data-people-action="request" data-id="'+p.id+'">Add friend</button>';
       return '<div class="chat-request-row">'+verifiedAvatar(p.avatar_url||DEFAULT_AVATAR,p,{size:"sm"})+
         '<div><strong>'+verifiedName(chatProfileLabel(p),p,{compact:true})+'</strong>'+
         '<small>'+escapeHTML(p.username||"")+'</small></div><div class="inline-actions">'+
         message+request+'</div></div>';
     }).join("")
   :'<div class="callout">No users found.</div>';
}

async function searchPeople(query) {
  state.peopleTerm = query; state.peopleResults = [];
  const version = ++state.peopleRequest;
  const target = $("peopleResults");
  if (query.length < 2) { target.innerHTML = '<div class="callout">Enter at least 2 characters to find people.</div>'; return; }
  target.innerHTML = '<div class="callout" role="status">Finding people…</div>';
  try {
    // Quote PostgREST filter values and escape LIKE wildcards; search public
    // names only. Email addresses are not a discovery directory.
    const pattern = JSON.stringify(`%${query.replace(/[\\%_]/g, character => `\\${character}`)}%`);
    const result = await supabase.from('public_profiles').select('id,display_name,username,avatar_url,is_verified,verification_tier,verification_expires_at,official_badge_kind,official_badge_title,frame_style,allow_messages,allow_requests')
      .neq('id', state.user.id).or(`display_name.ilike.${pattern},username.ilike.${pattern}`).limit(20);
    if (version !== state.peopleRequest || query !== $("peopleSearch").value.trim()) return;
    if (result.error) throw result.error;
    state.peopleResults = result.data || [];
    state.peopleResults.forEach(profile => state.friendProfiles.set(profile.id, profile));
    renderPeopleResults();
  } catch (error) {
    if (version !== state.peopleRequest) return;
    target.innerHTML = '<div class="callout">Could not search people. Change the search to retry.</div>';
    console.warn('People search failed:', error);
  }
}

async function loadStarred(){
  if(!state.user||!state.activeThreadId)return;
  const ids=state.messages.slice(-80).map(m=>m.id);
  if(!ids.length){state.starred.clear();return;}
  const {data,error}=await supabase.from('chat_message_stars')
     .select('message_id').eq('user_id',state.user.id).in('message_id',ids);
  if(error)throw error;
  state.starred=new Set((data||[]).map(x=>x.message_id));
}
async function toggleMessageStar(id){
  const message=state.messages.find(m=>m.id===id);
  if(!message||message.deleted_at)return;
  const was=state.starred.has(id);
  const operation=was?supabase.from('chat_message_stars').delete()
    .eq('message_id',id).eq('user_id',state.user.id):
    supabase.from('chat_message_stars').insert({message_id:id,user_id:state.user.id});
  const {error}=await operation;
  if(error)throw error;
  if(was)state.starred.delete(id);else state.starred.add(id);
  renderMessages({preserveScroll:true});
  window.siteToast?.(was?'Message removed from saved items.':'Message starred.',{type:'success'});
}
async function openStarredPanel(){
  if(!state.activeThreadId||!state.user)return;
  const list=$("chatStarredList");list.textContent='Loading starred messages…';
  openModal('chatStarredModal');
  const {data:stars,error}=await supabase.from('chat_message_stars')
    .select('message_id').eq('user_id',state.user.id).order('created_at',{ascending:false}).limit(200);
  if(error){list.textContent=error.message;return;}
  const ids=(stars||[]).map(x=>x.message_id);
  if(!ids.length){list.textContent='No starred messages yet.';return;}
  const {data:messages,error:messageError}=await supabase.from('direct_messages')
    .select('id,body,media_type,created_at').eq('thread_id',state.activeThreadId).in('id',ids).limit(200);
  if(messageError){list.textContent=messageError.message;return;}
  list.innerHTML=(messages||[]).length?(messages||[]).map(m=>`<button class="chat-starred-jump" type="button" data-starred-jump="${escapeHTML(m.id)}"><strong>★ Starred</strong><small>${escapeHTML((m.body||m.media_type||'Attachment').slice(0,140))}</small></button>`).join(''):
  '<div class="callout">No starred messages in this conversation.</div>';
}
function openForwardPicker(id){
  const message=state.messages.find(m=>m.id===id);
  if(!message||!message.body||message.media_url||message.media_path){
    window.siteToast?.("Only text messages can be forwarded right now.",{type:"info"});return;
  }
  state.forwardingMessageId=id;
  const target=$("chatForwardList");
  target.innerHTML=state.friends.map(friendId=>{
    const p=profileFor(friendId)||{};
    return `<button class="chat-forward-choice" type="button" data-forward-friend="${friendId}">${escapeHTML(chatProfileLabel(p))}</button>`;
  }).join('')+state.groups.map(g=>`<button class="chat-forward-choice" type="button" data-forward-group="${g.id}">Group · ${escapeHTML(g.name||'Group')}</button>`).join('')||
    '<div class="callout">No available conversations.</div>';
  openModal("chatForwardModal");
}
async function forwardTo(destination,recipientId=null){
  const messageId=state.forwardingMessageId;
  if(!messageId)return;
  const {data,error}=await supabase.rpc("forward_chat_text",{
    p_message_id:messageId,p_thread_id:destination,p_recipient_id:recipientId
  });
  if(error)throw error;
  closeModal("chatForwardModal");state.forwardingMessageId=null;
  if(destination===state.activeThreadId&&data){mergeMessage(data);renderMessages({preserveScroll:true});}
  await renderFriends();renderGroups();
  window.siteToast?.("Text forwarded.",{type:"success"});
}
function renderPinnedMessages(){
  const bar=$("chatPinnedBar");
  if(!bar)return;
  const items=state.pinnedMessages;
  bar.hidden=!items.length;
  if(!items.length){bar.replaceChildren();renderInfoPinned();return;}
  bar.innerHTML=items.map((m,index)=>{
    const snippet=escapeHTML((m.body|| (m.media_type?'📎 '+m.media_type:'Pinned message')).slice(0,95));
    return `<button type="button" class="chat-pinned-link" data-pinned-id="${m.id}" title="Go to pinned message">
      <span aria-hidden="true">📌</span><span class="chat-pinned-text"><strong>${index===0?'Pinned message':`Pinned ${index+1}`}</strong><small>${snippet}</small></span></button>`;
  }).join("");
  renderInfoPinned();
}
function renderInfoPinned(){
 const section=$("infoPinnedSection"),list=$("infoPinnedList"),count=$("chatInfoPinnedCount");
 if(!section||!list)return;
 const pinned=state.pinnedMessages;
 section.hidden=!pinned.length;
 if(count)count.textContent=String(pinned.length);
 list.innerHTML=pinned.map(m=>
  '<button type="button" class="chat-info-pinned-item" data-pinned-id="'+escapeHTML(m.id)+'">'+
  '<span aria-hidden="true">📌</span><span>'+escapeHTML(String(m.body||m.media_type||"Pinned message").slice(0,120))+'</span></button>'
 ).join("");
}
async function loadPinnedMessages(threadId){
  if(!threadId)return;
  const result=await supabase.from('direct_messages')
    .select('id,body,media_type,pinned_at,created_at')
    .eq('thread_id',threadId).not('pinned_at','is',null)
    .order('pinned_at',{ascending:false}).limit(3);
  if(result.error)throw result.error;
  if(threadId!==state.activeThreadId)return;
  state.pinnedMessages=result.data||[];
  renderPinnedMessages();
}
async function jumpToPinned(messageId){
  if(!messageId||!state.activeThreadId)return;
  let message=state.messages.find(m=>m.id===messageId);
  if(!message){
    const result=await supabase.from('direct_messages').select('*')
      .eq('id',messageId).eq('thread_id',state.activeThreadId).maybeSingle();
    if(result.error)throw result.error;
    if(!result.data)return;
    message=result.data;mergeMessage(message);await loadProfiles([message.sender_id]);
    renderMessages({preserveScroll:true});
  }
  const target=[...$("chatMessages").querySelectorAll('[data-message-id]')]
    .find(el=>el.dataset.messageId===messageId);
  if(target){target.scrollIntoView({behavior:'smooth',block:'center'});target.classList.add('is-highlighted');
    setTimeout(()=>target.classList.remove('is-highlighted'),1400);}
}
async function loadMessages(threadId, selection) {
  state.messages = [];
  state.historyCursor = null;
  state.hasOlderMessages = false;
  $("loadOlderMessages").hidden = true;
  const page = await fetchMessagePage(supabase, threadId);
  if (state.activeThreadId !== threadId || state.selection !== selection) return;
  await loadProfiles(page.messages.map(message => message.sender_id));
  if (state.activeThreadId !== threadId || state.selection !== selection) return;
  state.messages = page.messages;
  state.historyCursor = page.cursor;
  state.hasOlderMessages = page.hasMore;
  $("loadOlderMessages").hidden = !page.hasMore;
  renderMessages();
}
async function loadOlderMessages() {
  if (state.loadingHistory || !state.hasOlderMessages) return;
  const threadId = state.activeThreadId;
  const selection = state.selection;
  const button = $("loadOlderMessages");
  state.loadingHistory = true;
  button.disabled = true;
  try {
    const page = await fetchMessagePage(supabase, threadId, state.historyCursor);
    await loadProfiles(page.messages.map(message => message.sender_id));
    if (threadId !== state.activeThreadId || selection !== state.selection) return;
    const target = $("chatMessages");
    const offset = target.scrollHeight - target.scrollTop;
    const existing = new Set(state.messages.map(message => message.id));
    state.messages = [...page.messages.filter(message => !existing.has(message.id)), ...state.messages];
    state.historyCursor = page.cursor;
    state.hasOlderMessages = page.hasMore;
    button.hidden = !page.hasMore;
    renderMessages();
    renderInfoMedia();
    target.scrollTop = target.scrollHeight - offset;
  } finally {
    if (selection === state.selection) { state.loadingHistory = false; button.disabled = false; }
  }
}
function messageMediaHtml(m) { const url=m.media_url&&isSafeUrl(m.media_url)?m.media_url:''; if(!url)return ''; const type=resolveAttachmentType({mediaType:m.media_type,mediaUrl:url}); if(type==='image')return `<img class="message-attachment-image" src="${escapeHTML(url)}" alt="Message attachment" loading="lazy">`; if(type==='video')return `<video class="message-attachment-video" controls preload="metadata" src="${escapeHTML(url)}"></video>`; if(type==='audio')return voicePlayerHtml(escapeHTML(url)); return `<a class="message-file" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" download><strong>${escapeHTML(getDisplayFileName(url))}</strong><small>${escapeHTML(m.media_type||'File')} · Open or download</small></a>`; }
function updateReactionBadges(){
  // Never recreate a playing video, audio clip, or focused message while
  // another participant reacts. Replace only each message's reaction chips.
  const container=$("chatMessages");
  if(!container)return;
  for(const item of container.querySelectorAll(".chat-message[data-message-id]")){
    const m=state.messages.find(row=>row.id===item.dataset.messageId);
    if(!m)continue;
    const existing=item.querySelector(".chat-message-reactions");
    const html=m.deleted_at?'':reactionBadges(m);
    if(!html){existing?.remove();continue;}
    const holder=document.createElement('template');holder.innerHTML=html.trim();
    const replacement=holder.content.firstElementChild;
    if(existing)existing.replaceWith(replacement);
    else item.querySelector(".chat-message-meta")?.before(replacement);
  }
}
async function refreshReactions(threadId=state.activeThreadId){
  const ids=state.messages.slice(-80).filter(m=>!m.deleted_at).map(m=>m.id);
  if(!threadId||!ids.length){
    if(threadId===state.activeThreadId){state.reactions.clear();updateReactionBadges();}
    return;
  }
  const {data,error}=await supabase.rpc('chat_reaction_counts',{p_message_ids:ids});
  if(error)throw error;
  if(threadId!==state.activeThreadId)return;
  const grouped=new Map();
  for(const row of data||[]){
    if(!grouped.has(row.message_id))grouped.set(row.message_id,[]);
    grouped.get(row.message_id).push(row);
  }
  state.reactions=grouped;
  updateReactionBadges();
}
async function reactToMessage(messageId,emoji){
  if(!messageId||!['👍','❤️','😂','😮','😢','🔥'].includes(emoji))return;
  const m=state.messages.find(x=>x.id===messageId);
  if(!m||m.deleted_at||state.reactionBusy.has(messageId))return;
  const threadId=state.activeThreadId;
  state.reactionBusy.add(messageId);
  try{
    const {error}=await supabase.rpc('react_to_chat_message',{p_message_id:messageId,p_emoji:emoji});
    if(error)throw error;
    if(threadId===state.activeThreadId)await refreshReactions(threadId);
  }finally{state.reactionBusy.delete(messageId);}
}
function reactionBadges(m){
  const items=state.reactions.get(m.id)||[];
  if(!items.length)return '';
  return `<div class="chat-message-reactions" aria-label="Message reactions">${items.map(r=>`
    <button type="button" data-react-message="${escapeHTML(m.id)}" data-react-emoji="${escapeHTML(r.emoji)}"
      class="chat-reaction-chip ${r.mine?'mine':''}" aria-pressed="${r.mine?'true':'false'}"
      aria-label="${escapeHTML(r.emoji)} reaction: ${Number(r.reaction_count)||0}, ${r.mine?'you reacted':'tap to react'}">
      <span aria-hidden="true">${escapeHTML(r.emoji)}</span><small>${Number(r.reaction_count)||0}</small>
    </button>`).join('')}</div>`;
}
function renderMessages({ preserveScroll = false } = {}) { const target=$("chatMessages"); if(!target)return; const previousTop=target.scrollTop; const followBottom=!preserveScroll||target.scrollHeight-target.scrollTop-target.clientHeight<80; const q=state.messageSearchTerm.trim().toLowerCase(); const msgs=q?state.messages.filter(m=>String(m.body||'').toLowerCase().includes(q)):state.messages;const replyMap=new Map(state.messages.map(m=>[m.id,m])); if(!msgs.length){target.innerHTML=`<div class="chat-no-messages">${q?'No messages match your search.':'No messages yet. Start the conversation.'}</div>`;return;} target.innerHTML=msgs.map(m=>{const self=m.sender_id===state.user.id;const p=profileFor(m.sender_id)||{};const deleted=Boolean(m.deleted_at);
 const body=deleted?'This message was unsent':m.body?renderChatText(m.body,{verified:p.is_verified===true}):'';
 const canPin=!state.activeGroupId||isOwnerOfActiveGroup();
 return `<article class="chat-message ${self?'self':'received'} ${deleted?'is-unsent':''} ${m.pinned_at?'is-pinned':''}"
 data-message-id="${m.id}" data-message-self="${self?'true':'false'}"
 data-message-deleted="${deleted?'true':'false'}" data-can-pin="${canPin?'true':'false'}"
 data-message-created="${escapeHTML(asUtcTimestamp(m.created_at))}"
 data-message-pinned="${m.pinned_at?'true':'false'}" data-starred="${state.starred.has(m.id)?'true':'false'}"
 data-message-author="${escapeHTML(self?'You':chatProfileLabel(p))}">${!self&&state.activeGroupId?`<a class="chat-message-author" href="profile.html?id=${encodeURIComponent(m.sender_id)}" title="View member profile">${verifiedName(chatProfileLabel(p),p,{compact:true})}</a>`:''}${m.pinned_at?'<span class="chat-pin-indicator" aria-label="Pinned message">📌 Pinned</span>':''}${state.starred.has(m.id)?'<span class="chat-star-indicator">★ Starred</span>':''}${m.forwarded_from?'<span class="chat-forwarded-indicator">↗ Forwarded</span>':''}${replyQuoteHtml(m,replyMap)}${body?`<div class="chat-message-body">${body}</div>`:''}${deleted?'':messageMediaHtml(m)}${deleted?'':reactionBadges(m)}${!deleted&&String(m.body||'').startsWith('📊 Poll:')?`<div class="chat-bubble-poll" data-chat-poll-id="${escapeHTML(m.id)}"></div>`:''}${state.translations.has(m.id+'::'+state.settings.translateLanguage)?`<div class="chat-message-translation">${escapeHTML(state.translations.get(m.id+'::'+state.settings.translateLanguage))}</div>`:''}<div class="chat-message-meta"><span>${chatTimeAgo(m.created_at)}</span>${!deleted&&m.edited_at?'<span class="chat-edited-indicator" title="Message text was edited">Edited</span>':''}<button type="button" class="chat-message-actions" aria-label="Message actions" aria-haspopup="menu" aria-expanded="false">···</button></div></article>`}).join(''); target.scrollTop=followBottom?target.scrollHeight:previousTop;
  target.querySelectorAll("[data-chat-poll-id]").forEach(host=>{
    void mountPoll(host,'chat',host.dataset.chatPollId);
  });
}
function renderInfoMedia(){const grid=$("infoMediaGrid");if(!grid)return;const items=state.messages.filter(m=>{const t=resolveAttachmentType({mediaType:m.media_type,mediaUrl:m.media_url});return isSafeUrl(m.media_url||'')&&['image','video'].includes(t)}).slice(-18).reverse();grid.innerHTML=items.length?items.map(m=>{const t=resolveAttachmentType({mediaType:m.media_type,mediaUrl:m.media_url});return t==='video'?`<a href="${escapeHTML(m.media_url)}" target="_blank" rel="noopener noreferrer"><video src="${escapeHTML(m.media_url)}" muted preload="metadata"></video></a>`:`<a href="${escapeHTML(m.media_url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHTML(m.media_url)}" alt="Shared media" loading="lazy"></a>`}).join(''):`<div class="callout">No media shared yet.</div>`;}
async function loadGroupMembers(threadId){const result=await supabase.from('chat_members').select('id,user_id,role,tags,is_muted,is_pinned,last_read_at').eq('thread_id',threadId);if(result.error)throw result.error;const members=result.data||[];await loadProfiles(members.map(m=>m.user_id));state.groupMembers.set(threadId,members);renderGroupMembers();}
function renderGroupMembers(){
  const target=$("infoGroupMembers"),section=$("groupMembersSection");
  if(!target||!section||!state.activeGroupId)return;
  const members=state.groupMembers.get(state.activeGroupId)||[];
  section.hidden=false;$("groupMemberCount").textContent=String(members.length);
  if($("chatHeaderGroupCount")){$("chatHeaderGroupCount").hidden=false;$("chatHeaderGroupCount").textContent=members.length+" members";}
  updateGroupControlVisibility();
  const owner=isOwnerOfActiveGroup();
  const me=members.find(m=>m.user_id===state.user?.id);
  const canModerate=owner||me?.role==='admin';
  target.innerHTML=members.map(m=>{
    const p=profileFor(m.user_id)||{},tags=Array.isArray(m.tags)?m.tags:[];
    const role=String(m.role||'member');
    const editable=canModerate&&role!=='owner'&&(owner||m.user_id!==state.user.id);
    const removable=canModerate&&m.user_id!==state.user.id&&role!=='owner';
    return `<div class="group-member-row">
      ${verifiedAvatar(p.avatar_url||DEFAULT_AVATAR,p,{size:"md"})}
      <div class="group-member-copy">
        <strong><a href="profile.html?id=${encodeURIComponent(m.user_id)}" title="View member profile">${verifiedName(chatProfileLabel(p),p,{compact:true})}</a>${role!=='member'?' · '+escapeHTML(role):''}</strong>
        <div class="member-tag-list">${tags.map(tag=>`<span class="member-tag">${escapeHTML(tag)}</span>`).join('')||'<span class="member-tag muted">No tag</span>'}</div>
      </div>
      ${owner?`<button class="btn ghost sm" data-edit-member-tags="${m.id}" type="button">Tags</button>`:''}
      ${editable?`<select data-group-role="${m.user_id}" aria-label="Group role for ${escapeHTML(chatProfileLabel(p))}">
        ${['member','moderator','admin'].map(r=>`<option value="${r}" ${r===role?'selected':''}>${r}</option>`).join('')}
        </select>`:''}
      ${canModerate&&role!=='owner'&&m.user_id!==state.user.id?`<button class="btn ghost sm" type="button" data-group-suspend="${m.user_id}" data-hidden="false" aria-label="Suspend member from posting">Read-only</button><button class="btn ghost sm" type="button" data-group-suspend="${m.user_id}" data-hidden="true" aria-label="Hide group from suspended member">Hide</button><button class="btn ghost sm" type="button" data-group-lift="${m.user_id}">Lift</button>`:''}
      ${removable?`<button class="btn ghost sm" type="button" data-group-remove="${m.user_id}">Remove</button>`:''}
    </div>`;
  }).join('');
}
async function modifyGroupMember(memberId,action){
  if(!state.activeGroupId||!memberId)return;
  const groupId=state.activeGroupId;
  if(action==='remove'&&!await window.appUI.confirm("Remove this member from your group?"))return;
  const {error}=await supabase.rpc('manage_chat_group_member',{
    p_group:groupId,p_member:memberId,p_action:action
  });
  if(error)throw error;
  await loadGroupMembers(groupId);
  window.siteToast?.("Group membership updated.",{type:"success"});
}
async function translateChatMessage(messageId,{automatic=false}={}){
  if(!state.verified||!state.user||!state.activeThreadId)return;
  const message=state.messages.find(m=>m.id===messageId);
  if(!message||message.deleted_at||!String(message.body||'').trim())return;
  const lang=state.settings.translateLanguage||'en';
  const cacheKey=message.id+'::'+lang;
  if(state.translations.has(cacheKey)||state.translationBusy.has(cacheKey))return;
  if(automatic&&!state.settings.autoTranslate)return;
  state.translationBusy.add(cacheKey);
  try{
    const text=await translateVerifiedText(message.body,lang);
    if(!text)return;
    state.translations.set(cacheKey,text);
    if(state.messages.some(row=>row.id===messageId)&&state.activeThreadId===message.thread_id){
      const el=[...$("chatMessages").querySelectorAll(".chat-message")]
        .find(node=>node.dataset.messageId===messageId);
      let target=el?.querySelector(".chat-message-translation");
      if(el&&!target){
        target=document.createElement("div");target.className="chat-message-translation";
        el.querySelector(".chat-message-meta")?.before(target);
      }
      if(target)target.textContent=text;
    }
  }catch(error){
    if(!automatic)reportAppError(error,'Translation unavailable');
  }finally{state.translationBusy.delete(cacheKey);}
}
async function autoTranslateVisibleMessages(){
  if(!state.verified||!state.settings.autoTranslate)return;
  for(const m of state.messages.slice(-5)){
    if(m.sender_id!==state.user?.id&&m.body&&!m.deleted_at)
      await translateChatMessage(m.id,{automatic:true});
  }
}

function groupMemberRole(){
  if(!state.activeGroupId)return null;
  if(isOwnerOfActiveGroup())return 'owner';
  return (state.groupMembers.get(state.activeGroupId)||[]).find(m=>m.user_id===state.user?.id)?.role||null;
}
function updateGroupControlVisibility(){
  const g=activeGroup(),panel=$("groupMembershipControls");if(!panel)return;
  panel.hidden=!g;if(!g)return;
  const role=groupMemberRole(),settings=g.settings||{},owner=role==='owner';
  const mayAdd=owner||(role==='admin'&&settings.allow_admin_add_members!==false)||
    (role==='moderator'&&settings.allow_moderators_add_members===true)||
    (role==='member'&&settings.allow_members_add_members===true);
  $("groupAddMembersBtn").hidden=!mayAdd;
  $("groupShareInviteBtn").hidden=settings.allow_invite_links===false||
    !(owner||(role==='admin'&&settings.allow_admin_invite_links!==false));
  $("groupLeaveBtn").hidden=owner;
  $("groupUnbanBtn").hidden=!(owner||role==='admin');
  const notify=$("groupNotifyBtn");
  if(notify){notify.textContent=isMuted(g.id)?"Unmute alerts":"Notifications";notify.setAttribute("aria-pressed",String(isMuted(g.id)));}
  const mayEdit=owner||(role==='admin'&&settings.allow_admin_manage_settings===true);
  $("groupPermissionsPanel").hidden=!mayEdit;
  $("groupAllowAdminSettingsLabel").hidden=!owner;
  $("editGroupBtn").hidden=!mayEdit;
  const avatarEditor=document.querySelector("#groupEditor .group-avatar-upload");
  if(avatarEditor)avatarEditor.hidden=!owner;
}
async function groupAccessStatus(){
  const group=activeGroup();if(!group)return null;
  const groupId=group.id;
  const {data,error}=await supabase.rpc('chat_group_restriction_status',{p_group:groupId});
  if(error)throw error;
  if(state.activeGroupId!==groupId)return null;
  const row=(data||[]).find(x=>x.user_id===state.user?.id);
  const message=$("groupRestrictionNotice");
  if(message){
    message.hidden=!row;
    message.textContent=row?
      (row.mode==='hidden'?'Group content is temporarily restricted':'You can read this group but cannot participate')+
        ' until '+new Date(row.expires_at).toLocaleString():'';
  }
  const previous=previousGroupRestrictionMode;
  previousGroupRestrictionMode=row?.mode||null;
  if(row){
    state.canCompose=false;updateComposer();
    if(row.mode==='hidden'&&previous!=='hidden'){
      state.messages=[];state.pinnedMessages=[];renderPinnedMessages();
      $("chatMessages").textContent='Group messages are hidden during your suspension.';
      $("infoMediaGrid").textContent='Shared media is unavailable during your suspension.';
      void realtime.stop();
    }
  }else if(previous){
    state.canCompose=true;updateComposer();
    if(previous==='hidden'){void selectGroup(groupId).catch(e=>reportAppError(e,'Unable to refresh group access'));}
  }
  if(groupRestrictionTimer)clearTimeout(groupRestrictionTimer);
  // Refresh if staff lifts the restriction early or when the expiry arrives.
  // Database RLS remains authoritative between checks.
  const remaining=row?new Date(row.expires_at).getTime()-Date.now():30000;
  const delay=Math.max(1500,Math.min(30000,Number.isFinite(remaining)?remaining+400:30000));
  groupRestrictionTimer=setTimeout(()=>{
    if(state.activeGroupId===groupId)void groupAccessStatus().catch(e=>reportAppError(e,'Group restrictions could not be refreshed'));
  },delay);
  return row?.mode||null;
}
async function leaveCurrentGroup(){
  const g=activeGroup();if(!g||isOwnerOfActiveGroup())return;
  if(!await window.appUI.confirm('Leave '+(g.name||'this group')+'?'))return;
  const {error}=await supabase.rpc('leave_chat_group',{p_group:g.id});if(error)throw error;
  $("chatInfoPanel")?.close();state.groupMembers.delete(g.id);
  state.groups=state.groups.filter(x=>x.id!==g.id);
  await loadAllChatData();renderGroups();leaveConversation();
  window.siteToast?.('You left the group.',{type:'success'});
}
async function lookupGroupPerson(rawName){
  const handle=String(rawName||'').trim().replace(/^@/,'');
  if(!/^[a-zA-Z0-9_.-]{2,40}$/.test(handle))throw Error('Enter a valid username.');
  const exact=handle.replace(/[\\%_]/g,character=>'\\'+character);
  const {data,error}=await supabase.from('public_profiles')
    .select('id,username').ilike('username',exact).limit(10);
  if(error)throw error;
  const match=(data||[]).find(p=>String(p.username||'').toLowerCase()===handle.toLowerCase());
  if(!match)throw Error('No member has this exact username.');
  return match.id;
}
async function unbanGroupMember(){
  if(!activeGroup())return;
  const raw=await window.appUI.prompt('Enter the removed member’s @username to allow them to rejoin:','');
  if(raw===null)return;
  const person=await lookupGroupPerson(raw);
  if(person===activeGroup().created_by)throw Error('The group owner cannot be banned.');
  const {error}=await supabase.rpc('unban_chat_group_member',{p_group:state.activeGroupId,p_member:person});
  if(error)throw error;
  window.siteToast?.('Member can now be added or invited again.',{type:'success'});
}

async function addPeopleToGroup(){
  const g=activeGroup();if(!g)return;
  const existing=new Set((state.groupMembers.get(g.id)||[]).map(x=>x.user_id));
  const candidates=state.friends.filter(id=>!existing.has(id));
  const wrapper=document.createElement('div');wrapper.className='group-add-inline';
  const select=document.createElement('select');select.className='input';select.setAttribute('aria-label','Choose a friend to add');
  for(const id of candidates){
    const opt=document.createElement('option');opt.value=id;opt.textContent=chatProfileLabel(profileFor(id));select.add(opt);
  }
  const username=document.createElement('input');username.className='input';username.type='search';
  username.maxLength=40;username.placeholder='Or add someone by @username';
  username.setAttribute('aria-label','Member username');
  const submit=document.createElement('button');submit.type='button';submit.className='btn sm';submit.textContent='Add person';
  const cancel=document.createElement('button');cancel.type='button';cancel.className='btn ghost sm';cancel.textContent='Cancel';
  if(candidates.length)wrapper.append(select);
  wrapper.append(username,submit,cancel);$("groupMembershipControls").append(wrapper);
  cancel.onclick=()=>wrapper.remove();
  submit.onclick=async()=>{
    submit.disabled=true;
    try{
      let person=select.value;
      const handle=username.value.trim();
      if(handle)person=await lookupGroupPerson(handle);
      if(!person)throw Error('Choose a friend or enter a username.');
      const {error}=await supabase.rpc('add_group_chat_member',{p_group:g.id,p_user:person});
      if(error)throw error;
      wrapper.remove();await loadGroupMembers(g.id);
      window.siteToast?.('Member added.',{type:'success'});
    }catch(error){submit.disabled=false;reportAppError(error,'Unable to add member');}
  };
}
async function shareGroupInvite(){
  const g=activeGroup();if(!g)return;
  const {data,error}=await supabase.rpc('generate_chat_group_invite',{p_group:g.id});
  if(error)throw error;
  const link=new URL('chat.html',location.origin);link.searchParams.set('join',String(data));
  try{await navigator.clipboard.writeText(link.href);window.siteToast?.('Group invitation copied.',{type:'success'});}
  catch{await window.appUI.prompt('Copy this invitation link:',link.href);}
}
async function suspendMember(id,hidden=false){
  if(!id||id===activeGroup()?.created_by)return;
  const duration=await window.appUI.prompt('Suspend for how many minutes? Example: 60, 1440, 10080','60');
  if(duration===null)return;const minutes=Number(duration);
  if(!Number.isInteger(minutes)||minutes<1||minutes>525600)throw Error('Choose 1 to 525600 minutes.');
  const {error}=await supabase.rpc('suspend_chat_group_member',{p_group:state.activeGroupId,p_member:id,p_minutes:minutes,p_hidden:hidden});
  if(error)throw error;window.siteToast?.('Suspension applied.',{type:'success'});
}
async function liftMemberRestriction(id){
  const {error}=await supabase.rpc('lift_chat_group_suspension',{p_group:state.activeGroupId,p_member:id});
  if(error)throw error;window.siteToast?.('Restrictions lifted.',{type:'success'});
}
async function joinFromInvitation(token){
  if(!/^[0-9a-f]{64}$/.test(token))throw Error('Invalid invite link.');
  if(!state.user){location.href='login.html?next='+encodeURIComponent('chat.html?join='+token);return;}
  const {data,error}=await supabase.rpc('join_chat_group_by_invite',{p_token:token});
  if(error)throw error;
  history.replaceState({},'',location.pathname+'?group='+encodeURIComponent(String(data)));
  await loadAllChatData();renderGroups();
  if(data&&state.groups.some(g=>g.id===data))await selectGroup(data);
  window.siteToast?.('Joined the group.',{type:'success'});
}

async function saveGroupPermissions(){
  const group=activeGroup(),owner=isOwnerOfActiveGroup();
  if(!group||!(owner||(groupMemberRole()==='admin'&&group.settings?.allow_admin_manage_settings===true)))return;
  const settings={
    only_admins_post:$("groupAdminsOnly").checked,
    allow_media:$("groupAllowMedia").checked,
    allow_polls:$("groupAllowPolls").checked,
    slow_mode_seconds:Number($("groupSlowMode").value)||0,
    allow_members_add_members:$("groupAllowMembersAdd").checked,
    allow_moderators_add_members:$("groupAllowModeratorsAdd").checked,
    allow_admin_add_members:$("groupAllowAdminAdd").checked,
    allow_invite_links:$("groupAllowInviteLinks").checked,
    allow_admin_invite_links:$("groupAllowAdminInvites").checked};
  if(owner)settings.allow_admin_manage_settings=$("groupAllowAdminSettings").checked;
  const {data,error}=await supabase.rpc('update_chat_group_settings',{p_group:group.id,p_patch:settings});
  if(error)throw error;
  group.settings={...(group.settings||{}),...(data||{})};
  window.siteToast?.("Group permissions saved.",{type:"success"});
}
/* Chat header and contact pop-out use the same server-approved frame classes
   as the friend list. Group avatars never impersonate verified individuals. */
function refreshChatAvatarFrames(profile){
 const classes=verifiedFrameClasses(profile);
 for(const [id,size,extra] of [
   ["chatAvatarFrame","md","chat-header-avatar-frame"],
   ["infoAvatarFrame","xl","chat-info-avatar-frame"]
 ]){
   const element=$(id);
   if(element)element.className="tz-avatar-verified tz-avatar-verified--"+size+" "+extra+
     (classes?" "+classes:"");
 }
}
function updateHeaderForFriend(id){if($("chatHeaderGroupCount"))$("chatHeaderGroupCount").hidden=true;const p=profileFor(id)||{};$("chatAvatar").src=p.avatar_url||DEFAULT_AVATAR;refreshChatAvatarFrames(p);$("chatName").innerHTML=verifiedName(chatProfileLabel(p),p,{compact:true})+
    (["super","admin","moderator"].includes(p.role)?" · Staff":"");$("chatProfileBtn").href=`profile.html?id=${encodeURIComponent(id)}`;$("directInfoActions").hidden=false;$("groupInfoSection").hidden=true;$("groupMembersSection").hidden=true;$("infoPanelTitle").textContent='Chat details';}
function updateHeaderForGroup(g){
  const summary=$("chatInfoSummary");
  if(summary){summary.hidden=false;summary.textContent=String(g.description||"Group conversation");}
  const count=$("chatHeaderGroupCount");
  if(count){count.hidden=false;count.textContent=(state.groupMembers.get(g.id)||[]).length+" members";}
  const panel=$("groupPermissionsPanel");
  if(panel){
    panel.hidden=!isOwnerOfActiveGroup();
    const settings=g.settings||{};
    $("groupAdminsOnly").checked=settings.only_admins_post===true;
    $("groupAllowMedia").checked=settings.allow_media!==false;
    $("groupAllowPolls").checked=settings.allow_polls!==false;
    $("groupSlowMode").value=String(settings.slow_mode_seconds||0);
    $("groupAllowMembersAdd").checked=settings.allow_members_add_members===true;
    $("groupAllowModeratorsAdd").checked=settings.allow_moderators_add_members===true;
    $("groupAllowAdminAdd").checked=settings.allow_admin_add_members!==false;
    $("groupAllowInviteLinks").checked=settings.allow_invite_links!==false;
    $("groupAllowAdminInvites").checked=settings.allow_admin_invite_links!==false;
    $("groupAllowAdminSettings").checked=settings.allow_admin_manage_settings===true;
  }
  updateGroupControlVisibility();
  $("chatAvatar").src=g.avatar_url||DEFAULT_GROUP_AVATAR;refreshChatAvatarFrames(null);$("chatName").textContent=g.name||'Group';$("directInfoActions").hidden=true;$("groupInfoSection").hidden=false;$("groupMembersSection").hidden=false;$("infoPanelTitle").textContent='Group details';}
function refreshInfoProfile() {
  const group = activeGroup(), profile = profileFor(state.activeFriendId) || {};
  $("infoAvatar").src = group ? group.avatar_url || DEFAULT_GROUP_AVATAR : profile.avatar_url || DEFAULT_AVATAR;
  refreshChatAvatarFrames(group?null:profile);
  $("infoName").textContent = group ? group.name || 'Group' : chatProfileLabel(profile);
  $("infoStatus").textContent = group ? group.description || 'Group conversation' : profile.username ? `@${profile.username}` : 'Private conversation';
  const summary=$("chatInfoSummary");if(summary){summary.hidden=Boolean(!group);summary.textContent=group?((state.groupMembers.get(group.id)||[]).length+" members · "+(group.description||"Group chat")):"";}
  const owner=isOwnerOfActiveGroup();
  $("editGroupBtn").hidden=!(owner||(groupMemberRole()==='admin'&&group?.settings?.allow_admin_manage_settings===true));
}
function openConversationDetails({automatic=false}={}) {
  if (!state.activeThreadId || state.loadingThread) return;
  if(automatic&&(!state.activeGroupId||!window.matchMedia("(min-width: 1180px)").matches))return;
  const panel=$("chatInfoPanel");if(!panel)return;
  refreshInfoProfile();
  if(panel.open)return;
  $("chatInfoToggle")?.setAttribute("aria-expanded","true");
  if(window.matchMedia("(min-width: 1180px)").matches)panel.show();
  else panel.showModal();
}
function closeEditPanel(restoreFocus=false){
  state.editing=null;
  state.editSaving=false;
  const panel=$("chatEditPanel");
  if(panel)panel.hidden=true;
  if($("chatEditStatus"))$("chatEditStatus").textContent='Only the text or caption changes. Attachments stay as sent.';
  if($("chatEditSave"))$("chatEditSave").disabled=false;
  if($("chatEditCancel"))$("chatEditCancel").disabled=false;
  if($("chatEditBody"))$("chatEditBody").disabled=false;
  if(restoreFocus)$("chatBody")?.focus();
}
function beginEditMessage(messageId){
  if(state.sending||state.loadingThread||!state.activeThreadId||!state.canCompose)return;
  const message=state.messages.find(m=>m.id===messageId);
  if(!message||message.sender_id!==state.user?.id||message.deleted_at)return;
  // Entry is granted by the authoritative Supabase RPC, not client time.
  const panel=$("chatEditPanel"),area=$("chatEditBody");
  if(!panel||!area)return;
  // Editing gets its own text area: never replace or discard an unsent draft.
  state.editing={id:message.id,threadId:state.activeThreadId,expectedBody:message.body??null};
  state.editSaving=false;
  area.value=String(message.body||'');
  area.disabled=false;
  panel.hidden=false;
  $("chatEditRemaining").textContent='Your tier determines the editing window · checked by server';
  $("chatEditStatus").textContent='Edit text or caption. Your current draft is preserved.';
  area.focus();
  area.setSelectionRange(area.value.length,area.value.length);
  panel.scrollIntoView({block:'nearest',behavior:'auto'});
}
async function saveEditedMessage(){
  const editing=state.editing,body=$("chatEditBody")?.value;
  if(!editing||state.editSaving||editing.threadId!==state.activeThreadId)return;
  const value=String(body??'').trim();
  const message=state.messages.find(m=>m.id===editing.id);
  if(!message||message.deleted_at){closeEditPanel();return;}
  if(!value&&!message.media_url&&!message.media_path){
    $("chatEditStatus").textContent='Text messages cannot be empty. Use Unsend to remove one.';
    $("chatEditBody")?.focus();return;
  }
  if(value.length>10000){$("chatEditStatus").textContent='Maximum 10,000 characters.';return;}
  state.editSaving=true;
  const save=$("chatEditSave"),cancel=$("chatEditCancel"),area=$("chatEditBody");
  save.disabled=true;cancel.disabled=true;area.disabled=true;
  $("chatEditStatus").textContent='Saving edit…';
  try{
    const {data,error}=await supabase.rpc('edit_chat_message',{
      p_message_id:editing.id,p_new_body:value,p_expected_body:editing.expectedBody
    });
    if(error)throw error;
    if(!data||data.id!==editing.id||String(data.body||"").trim()!==value)
      throw Error("The server did not confirm this edit. Please retry before leaving the conversation.");
    if(state.activeThreadId===editing.threadId){
      if(data)mergeMessage(data);
      if(state.editing===editing)closeEditPanel(true);
      renderMessages({preserveScroll:true});
      void renderFriends();
      window.siteToast?.('Message edited.',{type:'success',title:'Chat'});
    }else if(state.editing===editing){
      closeEditPanel();
    }
  }catch(error){
    if(state.editing===editing){
      $("chatEditStatus").textContent=error.message||'Unable to save edit. Your text is still here.';
    }
  }finally{
    if(state.editing===editing){
      state.editSaving=false;
      save.disabled=false;cancel.disabled=false;area.disabled=false;
    }
  }
}
function renderReplyPreview(){
  const preview=$("chatReplyPreview"),reply=state.replyTo;
  if(!preview)return;
  preview.hidden=!reply;
  if(!reply)return;
  $("chatReplyAuthor").textContent=reply.author||"Unknown user";
  $("chatReplyExcerpt").textContent=reply.excerpt||"Attachment";
}
function cancelReply(){
  state.replyTo=null;
  renderReplyPreview();
}
function startLinkedReply(messageId){
  if(!messageId||!state.activeThreadId||!state.canCompose)return;
  const m=state.messages.find(row=>row.id===messageId);
  if(!m||m.deleted_at){window.siteToast?.("This message can no longer be replied to.",{type:"info"});return;}
  state.replyTo={
    id:m.id,threadId:state.activeThreadId,
    author:m.sender_id===state.user.id?"You":chatProfileLabel(profileFor(m.sender_id)),
    excerpt:String(m.body||m.media_type||"Attachment").slice(0,150)
  };
  renderReplyPreview();
  $("chatBody")?.focus();
}
function replyQuoteHtml(m,map){
  if(!m.reply_to)return "";
  const parent=map.get(m.reply_to);
  const author=parent?(parent.sender_id===state.user.id?"You":chatProfileLabel(profileFor(parent.sender_id))):"Message";
  const excerpt=parent?(parent.deleted_at?"Message unsent":String(parent.body||parent.media_type||"Attachment")):"Tap to view original message";
  return `<button type="button" class="chat-message-reply-ref" data-replied-id="${escapeHTML(m.reply_to)}" aria-label="Jump to replied message">
    <strong>${escapeHTML(author)}</strong><span>${escapeHTML(excerpt.slice(0,140))}</span></button>`;
}
function rememberDraft() {
  if (state.activeThreadId) state.drafts.set(state.activeThreadId, { body: $("chatBody").value, file: state.mediaFile });
}
function updateComposer() {
  const disabled = state.loadingThread || !state.activeThreadId || !state.canCompose;
  $("chatBody").disabled = disabled;
  $("chatMedia").disabled = disabled;
  if ($("chatAttachToggle")) $("chatAttachToggle").disabled = disabled;
  $("recordVoiceBtn").disabled = disabled;
  $("chatForm").querySelector('button[type="submit"]').disabled = disabled || state.sending;
  $("chatForm").setAttribute('aria-busy', String(state.sending));
}
async function selectConversation({ friendId = '', groupId = '' }) {
  if(friendId){
    const candidate=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(friendId);
    if(!candidate || friendId===state.user?.id)return;
    const permission=await supabase.rpc("can_send_direct_message",{p_recipient:friendId});
    if(permission.error||permission.data!==true){
      window.siteToast?.("This member's privacy or blocking settings do not permit direct messaging.","error");
      return;
    }
    if(!profileFor(friendId))await loadProfiles([friendId]);
  }
  const group = groupId ? state.groups.find(item => item.id === groupId) : null;
  if (groupId && !group) return;
  if(groupRestrictionTimer)clearTimeout(groupRestrictionTimer);
  previousGroupRestrictionMode=null;
  closeEditPanel(); cancelReply(); rememberDraft(); stopRecording(false); clearMediaPreview(); closeAttachMenu(); chatEnhancements.deactivate();
  state.messages=[];state.pinnedMessages=[];state.starred.clear();state.reactions.clear();renderPinnedMessages();
  const selection = ++state.selection;
  void realtime.stop();
  state.activeFriendId = friendId; state.activeGroupId = groupId; state.canCompose=true;
  const threadId = state.activeThreadId = groupId || threadForFriend(friendId);
  state.messageSearchTerm = ''; state.loadingHistory = false; state.messageVersions.clear();
  $("loadOlderMessages").disabled = false;
  state.loadingThread = true; updateComposer();
  const draft = state.drafts.get(threadId);
  $("chatBody").value = draft?.body || '';
  $("chatBody").style.height = 'auto';
  if (draft?.file) showMediaPreview(draft.file);
  closeHeaderMenu(); $("chatInfoPanel").close();
  if (group) updateHeaderForGroup(group); else updateHeaderForFriend(friendId);
  $("chatMessages").innerHTML = '<div class="chat-no-messages" role="status">Loading conversation…</div>';
  setView('chat'); setHeaderStatus('Loading…');
  try {
    if(group){
      await loadGroupMembers(threadId);
      let restriction;
      try{restriction=await groupAccessStatus();}
      catch(error){
        state.canCompose=false;state.loadingThread=false;updateComposer();
        $("chatMessages").textContent='Unable to verify group permissions. Try reopening this group.';
        reportAppError(error,'Group access unavailable');return;
      }
      if(selection!==state.selection)return;
      if(restriction==='hidden'){
        state.canCompose=false;state.loadingThread=false;updateComposer();
        $("chatMessages").textContent='Your access to group messages is temporarily suspended. The group will become visible when the restriction expires or an admin lifts it.';
        return;
      }
    }
    await loadMessages(threadId, selection);
    if (selection !== state.selection) return;
    await loadPinnedMessages(threadId);
    if (selection !== state.selection) return;
    await loadStarred();
    if (selection !== state.selection) return;
    renderMessages({preserveScroll:true});
    void refreshReactions(threadId).catch(error=>console.warn("Chat reactions unavailable:",error));
    if (group)updateGroupControlVisibility();
    if (selection !== state.selection) return;
    state.loadingThread = false; updateComposer();
    if(group)openConversationDetails({automatic:true});
    void chatEnhancements.activate(state.user.id,threadId,friendId).then(()=>{
      if(threadId===state.activeThreadId&&selection===state.selection) {
        const lastIncoming=state.messages.filter(m=>m.sender_id!==state.user.id).at(-1);
        if(lastIncoming)void chatEnhancements.markRead(lastIncoming.id);
      }
    });
    renderInfoMedia(); void renderFriends(); renderGroups();
    void autoTranslateVisibleMessages();
    void realtime.start(threadId).catch(error => reportAppError(error, 'Chat connection failed'));
  } catch (error) {
    if (selection !== state.selection) return;
    setHeaderStatus('Unable to load');
    $("chatMessages").innerHTML = '<div class="chat-no-messages">Could not load this conversation. Select it again to retry.</div>';
    reportAppError(error, 'Chat open failed');
  }
}
const selectFriend = id => selectConversation({ friendId: id });
const selectGroup = id => selectConversation({ groupId: id });
function leaveConversation() {
  closeEditPanel(); cancelReply(); rememberDraft(); ++state.selection; void realtime.stop(); chatEnhancements.deactivate();
  if(groupRestrictionTimer)clearTimeout(groupRestrictionTimer);
  groupRestrictionTimer=null;previousGroupRestrictionMode=null;
  state.activeThreadId = state.activeFriendId = state.activeGroupId = '';
  state.messages = [];state.pinnedMessages=[];state.starred.clear();state.reactions.clear();renderPinnedMessages(); state.loadingThread = false; updateComposer(); setView('list');
}
function mergeMessage(message) {
  if(state.editing?.id===message.id&&message.deleted_at)closeEditPanel();
  const index = state.messages.findIndex(item => item.id === message.id);
  if (index < 0) state.messages.push(message); else state.messages[index] = { ...state.messages[index], ...message };
  state.messages.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));
  const latest = state.messages.at(-1);
  if (latest) state.previews.set(latest.thread_id, latest);
}
async function refreshRecent(threadId) {
  const selection = state.selection, revision = state.messageRevision;
  const page = await fetchMessagePage(supabase, threadId);
  if (threadId !== state.activeThreadId || selection !== state.selection) return;
  await loadProfiles(page.messages.map(message => message.sender_id));
  if (threadId !== state.activeThreadId || selection !== state.selection) return;
  for (const message of page.messages) {
    if ((state.messageVersions.get(message.id) || 0) <= revision) mergeMessage(message);
  }
  renderMessages({ preserveScroll: true }); renderInfoMedia(); void renderFriends();
  const latestIncoming=state.messages.filter(m=>m.sender_id!==state.user.id).at(-1);
  if(latestIncoming)void chatEnhancements.markRead(latestIncoming.id);
  void loadPinnedMessages(threadId).catch(err=>console.warn("Pinned messages unavailable",err));
  void refreshReactions(threadId).catch(err=>console.warn("Chat reactions unavailable",err));
}
const realtime = createChatRealtime(supabase, {
  canConnect: () => navigator.onLine,
  onStatus: status => {
    state.connectionStatus=status;
    const fallback=state.activeGroupId?'Group conversation':state.peerPresenceLabel||'Chat available';
    const label=status==='offline'?'Offline':status==='reconnecting'?'Reconnecting…':status==='connecting'?'Syncing messages…':fallback;
    setHeaderStatus(label,status==='connected'&&state.peerPresenceLabel==='Active in chat');
  },
  onError: error => console.warn('Chat updates unavailable:', error),
  onReactionsChanged:threadId=>{
    if(threadId===state.activeThreadId)void refreshReactions(threadId)
      .catch(error=>console.warn("Reaction update unavailable:",error));
  },
  onConnected: refreshRecent,
  async onMessage(event, message, threadId) {
    const selection = state.selection;
    if (threadId !== state.activeThreadId) return;
    const exists = state.messages.some(item => item.id === message.id);
    if (event === 'UPDATE' && !exists) { void loadPinnedMessages(threadId).catch(console.warn); return; }
    state.messageVersions.set(message.id, ++state.messageRevision);
    mergeMessage(message); renderMessages({ preserveScroll: true }); renderInfoMedia(); void renderFriends();
    if(event!=='DELETE'&&message.sender_id!==state.user?.id&&message.body)
      void translateChatMessage(message.id,{automatic:true});
    if(event==="UPDATE")void loadPinnedMessages(threadId).catch(console.warn);
    if(message.sender_id!==state.user.id)void chatEnhancements.markRead(message.id);
    await loadProfiles([message.sender_id]);
    if (threadId !== state.activeThreadId || selection !== state.selection) return;
    renderMessages({ preserveScroll: true });
    if (event === 'INSERT' && !exists && message.sender_id !== state.user.id && state.settings.notifications && !isCurrentChatMuted()) {
      window.siteToast?.(`${chatProfileLabel(profileFor(message.sender_id))}: ${message.body || 'Attachment'}`, { type: 'info', title: 'New message' });
    }
  }
});
function closeAttachMenu(){
  const menu=$("chatAttachMenu");
  if(menu)menu.hidden=true;
  $("chatAttachToggle")?.setAttribute("aria-expanded","false");
}
function chooseAttachment(kind){
  if(!state.activeThreadId||!state.canCompose||state.sending)return;
  const input=$("chatMedia");if(!input)return;
  const formats={photo:"image/*,video/*",camera:"image/*",audio:"audio/*",document:"*/*"};
  if(!Object.hasOwn(formats,kind))return;
  input.accept=formats[kind];
  input.removeAttribute("capture");
  if(kind==="camera")input.setAttribute("capture","environment");
  closeAttachMenu();
  input.click();
}
function clearMediaPreview(){if(state.previewUrl)URL.revokeObjectURL(state.previewUrl);state.previewUrl='';state.mediaFile=null;state.mediaType='';if($("chatMediaPreview"))$("chatMediaPreview").innerHTML='';}
function showMediaPreview(file){clearMediaPreview();state.mediaFile=file;state.mediaType=resolveAttachmentType({mimeType:file.type,fileName:file.name});state.previewUrl=URL.createObjectURL(file);let c=state.mediaType==='image'?`<img src="${escapeHTML(state.previewUrl)}" alt="Attachment preview">`:state.mediaType==='video'?`<video controls src="${escapeHTML(state.previewUrl)}"></video>`:state.mediaType==='audio'?voicePlayerHtml(escapeHTML(state.previewUrl)):`<div class="media-preview-file"><strong>${escapeHTML(file.name)}</strong><small>${escapeHTML(file.type||'File')} · ${escapeHTML(formatFileSize(file.size))}</small></div>`;$("chatMediaPreview").innerHTML=`${c}<button class="btn ghost sm" id="removeChatMedia" type="button">Remove</button>`;$("removeChatMedia")?.addEventListener('click',clearMediaPreview);}
function stopRecorderTracks(){state.recorderStream?.getTracks().forEach(t=>t.stop());state.recorderStream=null;try{state.audioContext?.close();}catch(_){}state.audioContext=null;state.analyser=null;if(state.analyserFrame)cancelAnimationFrame(state.analyserFrame);state.analyserFrame=0;}
function formatDuration(ms){const total=Math.max(0,Math.floor(ms/1000));return `${Math.floor(total/60)}:${String(total%60).padStart(2,'0')}`;}
function animateWaveform(){const bars=[...document.querySelectorAll('#voiceWaveform [data-wave]')];const tick=()=>{bars.forEach((bar,i)=>{bar.style.height=`${8+Math.abs(Math.sin(Date.now()/180+i))*28}px`;});state.analyserFrame=requestAnimationFrame(tick);};tick();}
async function startRecording(){
  if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw new Error('Voice recording is not supported in this browser.');
  if(state.recordingStarting||state.recorder)return;
  state.recordingStarting=true;
  const requestId=++state.recordingRequestId;
  try{
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(requestId!==state.recordingRequestId){
      stream.getTracks().forEach(t=>t.stop());
      return;
    }
    state.recorderStream=stream;
    state.recorderChunks=[];
    const recorder=new MediaRecorder(stream);
    state.recorder=recorder;
    state.recorderStartedAt=Date.now();
    $("voiceWaveform").innerHTML=Array.from({length:40},(_,i)=>`<span data-wave="${i}"></span>`).join('');
    $("voiceRecordingSheet").hidden=false;
    animateWaveform();
    recorder.ondataavailable=e=>{if(e.data.size)state.recorderChunks.push(e.data);};
    recorder.onstop=()=>{
      // stopRecording clears state.recorder before this asynchronous callback.
      // Keep the original recorder MIME so Safari/Android previews stay playable.
      const mime=recorder.mimeType||state.recorderChunks[0]?.type||'audio/webm';
      const extension=mime.includes('mp4')?'m4a':mime.includes('ogg')?'ogg':'webm';
      const blob=new Blob(state.recorderChunks,{type:mime});
      if(blob.size)showMediaPreview(new File([blob],`voice-${Date.now()}.${extension}`,{type:mime}));
      stopRecorderTracks();
    };
    recorder.start(120);
    $("recordVoiceBtn").classList.add('is-recording');
    state.recorderTimer=setInterval(()=>$("voiceRecordingTimer").textContent=formatDuration(Date.now()-state.recorderStartedAt),200);
  } finally {
    state.recordingStarting=false;
  }
}
function stopRecording(save=true){
  state.recordingRequestId++;
  clearInterval(state.recorderTimer);
  state.recorderTimer=null;
  if($("voiceRecordingSheet"))$("voiceRecordingSheet").hidden=true;
  $("recordVoiceBtn")?.classList.remove('is-recording');
  if($("voiceRecordingTimer"))$("voiceRecordingTimer").textContent='0:00';
  if(!state.recorder){
    stopRecorderTracks();
    return;
  }
  if(!save){
    state.recorder.onstop=()=>stopRecorderTracks();
  }
  try{state.recorder.stop();}catch(_){stopRecorderTracks();}
  state.recorder=null;
}
async function sendMessage() {
  const body = ($("chatBody").value || '').trim();
  if (state.sending || state.loadingThread || !state.activeThreadId || (!body && !state.mediaFile)) return;
  // Capture the recipient before upload: switching chats must never redirect a
  // pending message or clear the draft in the newly selected conversation.
  const threadId = state.activeThreadId;
  const recipientId = state.activeFriendId || null;
  const file = state.mediaFile;
  const mediaType = state.mediaType;
  const reply=state.replyTo?.threadId===threadId?{...state.replyTo}:null;
  if(file && file.size>45*1024*1024)throw new Error("This attachment is too large for the current storage limit (45 MB). Trim or compress the video first.");
  const hint=$("chatStatus");
  state.sending = true; updateComposer();
  if(hint){hint.hidden=false;hint.textContent=file?
    `Uploading ${mediaType||'attachment'} (${formatFileSize(file.size)})… Keep this chat open.`:'Sending message…';}
  try {
    if(recipientId){
      // Recheck in case privacy, blocking or staff role changed while composing.
      const permission=await supabase.rpc("can_send_direct_message",{p_recipient:recipientId});
      if(permission.error||permission.data!==true)
        throw new Error("Messaging is no longer permitted by this member's privacy or blocking settings.");
    }
    const mediaUrl = file ? await uploadMedia(file, 'direct-messages') : '';
    if(hint)hint.textContent='Saving message…';
    // Signed links expire. Persist the private path so the authorization
    // function can renew access for the recipient after expiry.
    const mediaPath = file ? getChatMediaPath(mediaUrl) : null;
    if (file && !mediaPath) throw new Error('Uploaded chat attachment has no valid private path.');
    const payload = { id: crypto.randomUUID(), thread_id: threadId, sender_id: state.user.id, recipient_id: recipientId, body, reply_to:reply?.id||null, media_url: mediaUrl, media_path: mediaPath, media_type: mediaType || '' };
    const result = await supabase.from('direct_messages').insert(payload).select().single();
    if (result.error) throw result.error;
    const saved = result.data || payload;
    if (state.activeThreadId === threadId) {
      if (!state.messages.some(message => message.id === saved.id)) state.messages.push(saved);
      renderMessages();
      renderInfoMedia();
      if ($("chatBody").value.trim() === body) $("chatBody").value = '';
      $("chatBody").style.height = 'auto';
      if (state.mediaFile === file) clearMediaPreview();
      if(state.replyTo?.id===reply?.id)cancelReply();
      rememberDraft();
    }
    const draft = state.drafts.get(threadId);
    if (state.activeThreadId !== threadId && draft?.body.trim() === body && draft?.file === file) state.drafts.delete(threadId);
    state.previews.set(threadId,saved);
    if(recipientId&&!state.directPartners.includes(recipientId))state.directPartners.unshift(recipientId);
    await renderFriends(); renderGroups();
  } finally {
    state.sending = false; updateComposer();
    if(hint){hint.hidden=true;hint.textContent='';}
  }
}
function openModal(id){const dialog=$(id);if(!dialog)return;dialog.showModal();document.body.classList.add('modal-open');dialog.addEventListener('close',()=>document.body.classList.remove('modal-open'),{once:true});}
function closeModal(id){$(id)?.close();document.body.classList.remove('modal-open');}
function renderGroupPicker(){const target=$("groupMemberPicker");if(!target)return;target.innerHTML=state.friends.map(id=>{const p=profileFor(id)||{};return `<label class="chat-picker-row"><input type="checkbox" value="${id}">${verifiedAvatar(p.avatar_url||DEFAULT_AVATAR,p,{size:"sm",alt:""})}<span><strong>${escapeHTML(chatProfileLabel(p))}</strong><small>${escapeHTML(p.username||'')}</small></span></label>`}).join('');$("groupPickerEmpty").hidden=state.friends.length!==0;}
async function createGroup(){const name=($("newGroupName").value||'').trim();const selected=[...document.querySelectorAll('#groupMemberPicker input:checked')].map(i=>i.value);if(!name)throw new Error('Enter a group name.');if(!selected.length)throw new Error('Choose at least one friend.');const id=crypto.randomUUID(),now=new Date().toISOString();const thread=await supabase.from('chat_threads').insert({id,name,is_group:true,created_by:state.user.id,created_at:now,updated_at:now,settings:{}}).select().single();if(thread.error)throw thread.error;const members=[...new Set([state.user.id,...selected])].map(user_id=>({id:crypto.randomUUID(),thread_id:id,user_id,role:user_id===state.user.id?'owner':'member',joined_at:now,tags:[]}));const result=await supabase.from('chat_members').insert(members);if(result.error){await supabase.from('chat_threads').delete().eq('id',id);throw result.error;}closeModal('friendPickerModal');await loadAllChatData();renderGroups();await selectGroup(id);}
async function editGroup(){
  const group=activeGroup(),owner=isOwnerOfActiveGroup();
  if(!group||!(owner||(groupMemberRole()==='admin'&&group.settings?.allow_admin_manage_settings===true)))return;
  const name=($("groupNameInput").value||'').trim().slice(0,80);
  const description=($("groupDescriptionInput").value||'').trim().slice(0,300);
  if(!name)throw Error('Group name is required.');
  let avatarUrl=null;
  if(owner&&$("groupAvatarInput")?.files?.[0])
    avatarUrl=await uploadMedia($("groupAvatarInput").files[0],`group-avatars/${state.user.id}`);
  const change=await supabase.rpc('update_chat_group_details',{p_group:group.id,p_name:name,p_description:description});
  if(change.error)throw change.error;
  if(avatarUrl){
    const imageUpdate=await supabase.from('chat_threads').update({avatar_url:avatarUrl})
      .eq('id',group.id).eq('created_by',state.user.id);
    if(imageUpdate.error)throw imageUpdate.error;
    group.avatar_url=avatarUrl;
  }
  group.name=name;group.description=description;
  updateHeaderForGroup(group);refreshInfoProfile();renderGroups();$("groupEditor").hidden=true;
}
async function editMemberTags(memberId){if(!isOwnerOfActiveGroup())return;const member=(state.groupMembers.get(state.activeGroupId)||[]).find(m=>m.id===memberId);if(!member)return;const raw=await window.appUI.prompt('Member tags for this group, separated by commas:',(member.tags||[]).join(', '));if(raw===null)return;const tags=[...new Set(raw.split(',').map(t=>t.trim()).filter(Boolean).slice(0,8))];const result=await supabase.from('chat_members').update({tags}).eq('id',memberId).eq('thread_id',state.activeGroupId);if(result.error)throw result.error;member.tags=tags;renderGroupMembers();}
async function toggleChatMemberFlag(kind){
  const threadId=state.activeThreadId;if(!threadId)return;
  if(kind==='mute'){
    const next=!isMuted(threadId);
    await setPersonalChatView({muted:next});
    window.siteToast?.(next?'Notifications muted for this conversation.':'Conversation notifications enabled.',{type:'success'});
    return;
  }
  if(kind!=='pin'||!state.activeGroupId)return;
  const existing=await supabase.from('chat_members').select('is_pinned').eq('thread_id',threadId).eq('user_id',state.user.id).maybeSingle();
  if(existing.error)throw existing.error;
  if(!existing.data)throw Error('Group membership required to pin a chat.');
  const next=!Boolean(existing.data.is_pinned);
  const result=await supabase.from('chat_members').update({is_pinned:next}).eq('thread_id',threadId).eq('user_id',state.user.id);
  if(result.error)throw result.error;
  const group=activeGroup();if(group)group.is_pinned=next;renderGroups();
  window.siteToast?.(next?'Group pinned.':'Group unpinned.',{type:'success'});
}
function keepPeopleSearchFocus(event){
 const panel=$("peopleSearchPanel");
 if(event.key!=="Tab"||!panel||panel.hidden)return;
 const focusable=[...panel.querySelectorAll('button:not([disabled]),input:not([disabled]),a[href]')].filter(el=>el.getClientRects().length);
 if(!focusable.length){event.preventDefault();return;}
 const first=focusable[0],last=focusable[focusable.length-1];
 if(!panel.contains(document.activeElement)){event.preventDefault();(event.shiftKey?last:first).focus();return;}
 if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
 else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
}
let peopleSearchOpener=null;
function closePeopleSearch(){
 const panel=$("peopleSearchPanel");if(!panel||panel.hidden)return;
 panel.hidden=true;$("peopleSearchBackdrop")?.remove();
 for(const id of ["peopleSearchToggle","chatFindPeopleButton"])$(id)?.setAttribute("aria-expanded","false");
 (peopleSearchOpener?.isConnected?peopleSearchOpener:$("peopleSearchToggle"))?.focus();
 peopleSearchOpener=null;
}
function togglePeopleSearch(event){
 const panel=$("peopleSearchPanel");if(!panel)return;
 if(!state.user){location.assign("login.html?next=chat.html");return;}
 if(!panel.hidden){closePeopleSearch();return}
 peopleSearchOpener=event?.currentTarget||document.activeElement;
 document.body.append(panel);
 const backdrop=document.createElement("div");
 backdrop.id="peopleSearchBackdrop";backdrop.className="chat-find-backdrop";
 backdrop.addEventListener("click",closePeopleSearch);
 document.body.append(backdrop);
 panel.hidden=false;
 for(const id of ["peopleSearchToggle","chatFindPeopleButton"])$(id)?.setAttribute("aria-expanded","true");
 $("peopleSearch")?.focus();renderPeopleResults();
}
function activateChatTab(name){
 const tabs=[...document.querySelectorAll('.chat-tab')],panels=[...document.querySelectorAll('.chat-tab-panel')];
 if(!panels.some(p=>p.dataset.panel===name))return;
 tabs.forEach(tab=>{const active=tab.dataset.tab===name;tab.classList.toggle('active',active);tab.setAttribute('aria-selected',String(active));tab.tabIndex=(active||(name==='blocked'&&tab.dataset.tab==='all'))?0:-1;});
 panels.forEach(panel=>panel.hidden=panel.dataset.panel!==name);
 $("chatBlockedToggle")?.setAttribute('aria-pressed',String(name==='blocked'));
 closePeopleSearch();
}
function setupTabs(){
 const tabs=[...document.querySelectorAll('.chat-tab:not(.chat-tab-secondary)')];
 tabs.forEach(tab=>{
  tab.addEventListener('click',()=>activateChatTab(tab.dataset.tab));
  tab.addEventListener('keydown',event=>{
   if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
   event.preventDefault();
   const index=tabs.indexOf(tab);
   const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:
    (index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
   activateChatTab(tabs[next].dataset.tab);tabs[next].focus();
  });
 });
 $("chatBlockedToggle")?.addEventListener('click',()=>activateChatTab('blocked'));
 $("chatInfoPanel")?.addEventListener("close",()=>{$("chatInfoToggle")?.setAttribute("aria-expanded","false");});
 $("chatMobileCreate")?.addEventListener('click',()=>{$("newGroupBtn")?.click();});
}

function setupChatEmojiMenu(){
 const button=$("chatEmojiToggle"),menu=$("chatEmojiMenu"),field=$("chatBody");
 if(!button||!menu||!field)return;
 const choices=["😀","😊","😂","🥰","❤️","👍","🔥","🎉","🙏","💯","✨","😎","😢","🙌","💚","👏","🤔","🚀"];
 menu.replaceChildren(...choices.map(emoji=>{
  const item=document.createElement("button");item.type="button";item.textContent=emoji;
  item.className="chat-emoji-item";item.setAttribute("aria-label","Insert "+emoji);
  item.addEventListener("click",()=>{
   const start=field.selectionStart??field.value.length,end=field.selectionEnd??start;
   field.setRangeText(emoji,start,end,"end");field.focus();
   field.dispatchEvent(new Event("input",{bubbles:true}));menu.hidden=true;button.setAttribute("aria-expanded","false");
  });return item;
 }));
 button.addEventListener("click",()=>{
  menu.hidden=!menu.hidden;button.setAttribute("aria-expanded",String(!menu.hidden));
  if(!menu.hidden)menu.querySelector("button")?.focus();
 });
 menu.addEventListener("keydown",e=>{
  if(e.key==="Escape"){menu.hidden=true;button.setAttribute("aria-expanded","false");button.focus();}
 });
 document.addEventListener("pointerdown",e=>{
  if(menu.hidden||menu.contains(e.target)||button.contains(e.target))return;
  menu.hidden=true;button.setAttribute("aria-expanded","false");
 });
}
function setupEvents(){
  setupChatEmojiMenu();
  $("peopleSearchPanel")?.addEventListener("keydown",keepPeopleSearchFocus);
  $("loadOlderMessages")?.addEventListener("click", () => loadOlderMessages().catch(error => reportAppError(error, "Unable to load older messages")));
  setupMentionInput($("chatBody"));
  setupMentionInput($("chatEditBody"));
  $("chatForwardList")?.addEventListener('click',e=>{
    const friend=e.target.closest('[data-forward-friend]')?.dataset.forwardFriend;
    const group=e.target.closest('[data-forward-group]')?.dataset.forwardGroup;
    if(friend)void forwardTo(threadForFriend(friend),friend).catch(err=>reportAppError(err,'Forwarding failed'));
    if(group)void forwardTo(group,null).catch(err=>reportAppError(err,'Forwarding failed'));
  });
  $("chatStarredList")?.addEventListener('click',e=>{
    const id=e.target.closest('[data-starred-jump]')?.dataset.starredJump;
    if(id){closeModal('chatStarredModal');void jumpToPinned(id).catch(err=>reportAppError(err,'Saved message unavailable'));}
  });
  $("groupLeaveBtn")?.addEventListener('click',()=>void leaveCurrentGroup().catch(e=>reportAppError(e,'Unable to leave group')));
  $("groupAddMembersBtn")?.addEventListener('click',()=>void addPeopleToGroup().catch(e=>reportAppError(e,'Unable to add people')));
  $("groupShareInviteBtn")?.addEventListener('click',()=>void shareGroupInvite().catch(e=>reportAppError(e,'Invite link unavailable')));
  $("groupNotifyBtn")?.addEventListener('click',()=>void toggleChatMemberFlag('mute').then(()=>updateGroupControlVisibility()).catch(e=>reportAppError(e,'Unable to update notifications')));
  $("groupUnbanBtn")?.addEventListener('click',()=>void unbanGroupMember().catch(e=>reportAppError(e,'Unable to unban member')));
  $("saveGroupPermissions")?.addEventListener("click",()=>void saveGroupPermissions()
    .catch(error=>reportAppError(error,"Unable to save group permissions")));
  $("chatPinnedBar")?.addEventListener("click",e=>{const b=e.target.closest("[data-pinned-id]");if(b)void jumpToPinned(b.dataset.pinnedId).catch(err=>reportAppError(err,"Pinned message unavailable"));});
  $("infoPinnedList")?.addEventListener("click",event=>{
   const id=event.target.closest("[data-pinned-id]")?.dataset.pinnedId;if(!id)return;
   if(window.innerWidth<1180)$("chatInfoPanel")?.close();
   void jumpToPinned(id).catch(err=>reportAppError(err,"Pinned message unavailable"));
  });
  $("chatSearch")?.addEventListener('input',async e=>{state.searchTerm=e.target.value||'';await renderFriends();renderGroups();}); bindSearch($("peopleSearch"), searchPeople);
  for(const listId of ["friendList","dmsList","groupList"]){
   $(listId)?.addEventListener('click',event=>{
    const friend=event.target.closest('[data-friend-id]')?.dataset.friendId;
    const group=event.target.closest('[data-group-id]')?.dataset.groupId;
    if(friend)void selectFriend(friend).catch(err=>reportAppError(err,'Chat open failed'));
    if(group)void selectGroup(group).catch(err=>reportAppError(err,'Group open failed'));
   });
  }
  $("archivedList")?.addEventListener('click',e=>{
    const friend=e.target.closest('[data-friend-id]')?.dataset.friendId;
    const group=e.target.closest('[data-group-id]')?.dataset.groupId;
    if(friend)void selectFriend(friend).catch(error=>reportAppError(error,'Archived chat unavailable'));
    if(group)void selectGroup(group).catch(error=>reportAppError(error,'Archived group unavailable'));
  });
  $("friendRequests")?.addEventListener('click',handleRequests); $("friendRequestsSent")?.addEventListener('click',handleRequests);
  $("blockedList")?.addEventListener('click',async e=>{const b=e.target.closest('[data-unblock]');if(!b)return;const row=state.friendships.find(r=>r.status==='blocked'&&r.blocked_by===state.user.id&&(r.requester_id===b.dataset.unblock||r.addressee_id===b.dataset.unblock));if(row)await supabase.from('friendships').delete().eq('id',row.id);await loadAllChatData();renderBlocked();await renderFriends();});
  $("peopleResults")?.addEventListener('click', async event => {
    const button = event.target.closest('button[data-people-action]');
    if (!button || button.disabled || !state.user) return;
    button.disabled = true;
    try {
      if (button.dataset.peopleAction === 'message') await selectFriend(button.dataset.id);
      else {
        const result = await supabase.from('friendships').insert({ id: crypto.randomUUID(), requester_id: state.user.id, requester_name: getDisplayName(state.user), addressee_id: button.dataset.id, status: 'pending', created_at: new Date().toISOString() });
        if (result.error) throw result.error;
        await loadAllChatData(); renderPeopleResults(); renderRequests();
      }
    } catch (error) { reportAppError(error, 'Unable to start conversation or friend request'); }
    finally { if (button.isConnected) button.disabled = false; }
  });
  $("chatReplyCancel")?.addEventListener('click',()=>{cancelReply();$("chatBody")?.focus();});
  $("chatMessages")?.addEventListener('click',e=>{
    const button=e.target.closest('[data-react-message][data-react-emoji]');
    if(button)void reactToMessage(button.dataset.reactMessage,button.dataset.reactEmoji)
      .catch(err=>reportAppError(err,'Could not update reaction'));
  });
  $("chatMessages")?.addEventListener('click',e=>{
    const id=e.target.closest('[data-replied-id]')?.dataset.repliedId;
    if(id)void jumpToPinned(id).catch(err=>reportAppError(err,"Unable to load replied message"));
  });
  $("chatWallpaper")?.addEventListener("change",e=>{
    state.settings.wallpaper=e.target.value;
    void saveSettings();
  });
  $("chatTextSize")?.addEventListener("change",e=>{
    state.settings.fontSize=e.target.value;
    void saveSettings();
  });
  $("chatTranslateLanguage")?.addEventListener('change',e=>{
    state.settings.translateLanguage=e.target.value;
    void saveSettings();
    renderMessages({preserveScroll:true});
    void autoTranslateVisibleMessages();
  });
  $("chatEditSave")?.addEventListener('click',()=>void saveEditedMessage());
  $("chatEditCancel")?.addEventListener('click',()=>closeEditPanel(true));
  $("chatEditBody")?.addEventListener('keydown',e=>{
    if(e.key==='Escape'){e.preventDefault();closeEditPanel(true);}
    if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){
      e.preventDefault();void saveEditedMessage();
    }
  });
  $("chatBody")?.addEventListener('input',()=>{const t=$("chatBody");t.style.height='auto';t.style.height=`${Math.min(t.scrollHeight,140)}px`;});
  $("chatBody")?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing&&state.settings.enterToSend){e.preventDefault();sendMessage().catch(err=>reportAppError(err,'Message send failed'));}}); $("chatForm")?.addEventListener('submit',e=>{e.preventDefault();sendMessage().catch(err=>reportAppError(err,'Message send failed'));});
  $("chatMedia")?.addEventListener('change',e=>{
    const f=e.target.files?.[0];
    if(f?.size>45*1024*1024){
      window.siteToast?.("File too large for chat storage. Try a video or document below 45 MB.",{type:"error",title:"Attachment"});
    }else if(f)showMediaPreview(f);
    e.target.value='';
  });
  $("chatAttachToggle")?.addEventListener("click",event=>{
    event.stopPropagation();
    const menu=$("chatAttachMenu");if(!menu)return;
    const shouldOpen=menu.hidden;closeAttachMenu();
    if(shouldOpen){menu.hidden=false;$("chatAttachToggle").setAttribute("aria-expanded","true");}
  });
  $("chatAttachMenu")?.addEventListener("click",event=>{
    const button=event.target.closest("[data-attach-kind]");
    if(button)chooseAttachment(button.dataset.attachKind);
  });
  document.addEventListener("click",event=>{
    if(!event.target.closest("#chatAttachMenu,#chatAttachToggle"))closeAttachMenu();
  });
  document.addEventListener("keydown",event=>{
    if(event.key==="Escape")closeAttachMenu();
  });
  $("recordVoiceBtn")?.addEventListener('click',()=>{
    if(state.recorder||state.recordingStarting){stopRecording(false);return;}
    startRecording().catch(err=>{
      stopRecording(false);
      window.siteToast?.(err.message||'Voice recording unavailable.',{type:'error',title:'Voice recording'});
    });
  });
  $("voiceCancelBtn")?.addEventListener('click',()=>{stopRecording(false);clearMediaPreview();});
  $("voiceStopBtn")?.addEventListener('click',()=>stopRecording(true));
  $("voiceRecordingSheet")?.addEventListener('click',e=>{if(e.target===$("voiceRecordingSheet")){stopRecording(false);clearMediaPreview();}});
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!$("voiceRecordingSheet")?.hidden){stopRecording(false);clearMediaPreview();}});
  $("chatBackBtn")?.addEventListener('click',leaveConversation); $("chatInfoToggle")?.addEventListener('click', openConversationDetails); $("chatInfoClose")?.addEventListener('click',()=>$("chatInfoPanel").close());
  $("chatInfoPanel")?.addEventListener('click', event => {
    const panel = event.currentTarget, rect = panel.getBoundingClientRect();
    if (event.target === panel && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom)) panel.close();
  });
  $("chatMessageSearchToggle")?.addEventListener('click',async ()=>{if(!state.activeThreadId)return;const term=await window.appUI.prompt('Search in this chat (leave blank to show all messages):',state.messageSearchTerm);if(term===null)return;state.messageSearchTerm=term.trim();renderMessages();});
  $("chatMenuToggle")?.addEventListener('click',e=>{e.stopPropagation();$("chatHeaderMenu").hidden?openHeaderMenu():closeHeaderMenu();}); document.addEventListener('click',e=>{if(!e.target.closest('.chat-header-actions'))closeHeaderMenu();});
  $("chatHeaderMenu")?.addEventListener('click',async e=>{const a=e.target.closest('[data-chat-menu]')?.dataset.chatMenu;if(!a)return;closeHeaderMenu();if(a==='starred')await openStarredPanel();
    if(a==='details'||a==='media'){openConversationDetails();if(a==='media')setTimeout(()=>$("infoMediaGrid")?.scrollIntoView({block:"nearest"}),50);}if(a==='settings'){defaultSettingsUI();openModal('chatSettingsModal');}if(a==='poll'&&state.activeGroupId){
    if(activeGroup()?.settings?.allow_polls===false)window.appUI?.toast?.("Polls disabled by group owner.");
    else await openPollComposer('group',state.activeGroupId,
      async()=>{await refreshRecent(state.activeThreadId);});
  }
  if(a==='mute'||a==='pin')await toggleChatMemberFlag(a).catch(error=>reportAppError(error,'Could not change chat preference'));
  if(a==='archive')await toggleCurrentArchive().catch(error=>reportAppError(error,'Could not archive chat'));
  if(a==='clear')await clearCurrentChat().catch(error=>reportAppError(error,'Could not clear chat'));
  if(a==='report')await reportActiveConversation().catch(error=>reportAppError(error,'Could not submit report'));});
  document.querySelectorAll('[data-close-modal]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.closeModal))); document.querySelectorAll('[data-chat-setting]').forEach(i=>i.addEventListener('change',()=>{state.settings[i.dataset.chatSetting]=i.checked;saveSettings();}));
  $("peopleSearchToggle")?.addEventListener("click",togglePeopleSearch);
  $("chatFindPeopleButton")?.addEventListener("click",togglePeopleSearch);
  $("peopleSearchClose")?.addEventListener("click",closePeopleSearch);
  document.addEventListener("keydown",event=>{if(event.key==="Escape"&&!$("peopleSearchPanel")?.hidden)closePeopleSearch();}); $("newGroupBtn")?.addEventListener('click',()=>{renderGroupPicker();openModal('friendPickerModal');}); $("friendPickerClose")?.addEventListener('click',()=>closeModal('friendPickerModal')); $("friendPickerCancel")?.addEventListener('click',()=>closeModal('friendPickerModal')); $("friendPickerCreate")?.addEventListener('click',()=>createGroup().catch(err=>window.siteToast?.(err.message,{type:'error',title:'Create group'})));
  $("groupMemberSearch")?.addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();document.querySelectorAll('#groupMemberPicker .chat-picker-row').forEach(r=>r.hidden=!r.innerText.toLowerCase().includes(q));}); $("editGroupBtn")?.addEventListener('click',()=>{const g=activeGroup();if(g){$("groupAvatarPreview").src=g.avatar_url||DEFAULT_GROUP_AVATAR;$("groupNameInput").value=g.name||'';$("groupDescriptionInput").value=g.description||'';$("groupEditor").hidden=false;}}); $("groupAvatarInput")?.addEventListener('change',e=>{const f=e.target.files?.[0];if(f)$("groupAvatarPreview").src=URL.createObjectURL(f);}); $("cancelGroupBtn")?.addEventListener('click',()=>{$("groupEditor").hidden=true;}); $("saveGroupBtn")?.addEventListener('click',()=>editGroup().catch(err=>window.siteToast?.(err.message,{type:'error',title:'Group settings'}))); $("infoGroupMembers")?.addEventListener('click',e=>{
    const suspend=e.target.closest('[data-group-suspend]');
    if(suspend)void suspendMember(suspend.dataset.groupSuspend,suspend.dataset.hidden==='true').catch(err=>reportAppError(err,'Unable to suspend member'));
    const lift=e.target.closest('[data-group-lift]');
    if(lift)void liftMemberRestriction(lift.dataset.groupLift).catch(err=>reportAppError(err,'Unable to lift restriction'));
    const b=e.target.closest('[data-edit-member-tags]');
    if(b)editMemberTags(b.dataset.editMemberTags).catch(err=>window.siteToast?.(err.message,{type:'error',title:'Member tag'}));
    const remove=e.target.closest('[data-group-remove]');
    if(remove)modifyGroupMember(remove.dataset.groupRemove,'remove')
      .catch(err=>reportAppError(err,'Unable to remove member'));
  });
  $("infoGroupMembers")?.addEventListener('change',e=>{
    const select=e.target.closest('[data-group-role]');
    if(select)modifyGroupMember(select.dataset.groupRole,select.value)
      .catch(err=>reportAppError(err,'Unable to change group role'));
  });
  window.addEventListener('online',()=>{if(state.activeThreadId&&!state.loadingThread)void realtime.start(state.activeThreadId);}); window.addEventListener('offline',()=>{void realtime.stop();if(state.activeThreadId)setHeaderStatus('Offline');});
  window.addEventListener('timzee:chat-refresh',e=>{
    const threadId=state.activeThreadId,messageId=e.detail?.messageId;
    if(!threadId)return;
    void (async()=>{
      if(messageId){
        const {data,error}=await supabase.from('direct_messages').select('*')
          .eq('id',messageId).eq('thread_id',threadId).maybeSingle();
        if(error)throw error;
        if(data&&state.activeThreadId===threadId){
          mergeMessage(data);renderMessages({preserveScroll:true});
        }
      }
      await refreshRecent(threadId);
    })().catch(err=>reportAppError(err,'Unable to refresh chat'));
  });
  window.addEventListener('timzee:chat-react',e=>{
    if(e.detail?.messageId&&e.detail.emoji)void reactToMessage(e.detail.messageId,e.detail.emoji)
      .catch(err=>reportAppError(err,'Could not update reaction'));
  });
  window.addEventListener('timzee:chat-reply-message',e=>{
    if(e.detail?.messageId)startLinkedReply(e.detail.messageId);
  });
  window.addEventListener('timzee:chat-star',e=>{
    if(e.detail?.messageId)void toggleMessageStar(e.detail.messageId)
      .catch(err=>reportAppError(err,'Unable to star message'));
  });
  window.addEventListener('timzee:chat-forward',e=>{
    if(e.detail?.messageId)openForwardPicker(e.detail.messageId);
  });
  window.addEventListener('timzee:chat-translate',e=>{
    if(e.detail?.messageId)void translateChatMessage(e.detail.messageId);
  });
  window.addEventListener('timzee:chat-edit-message',e=>{
    if(e.detail?.messageId)beginEditMessage(e.detail.messageId);
  });
  window.addEventListener('timzee:chat-message-info',e=>{
    if(e.detail?.messageId)void chatEnhancements.messageInfo(e.detail.messageId)
      .catch(err=>reportAppError(err,'Message info unavailable'));
  });
  window.addEventListener('pagehide',()=>{void realtime.stop();stopRecording(false);chatEnhancements.deactivate();});
  window.addEventListener('pageshow',event=>{if(event.persisted&&state.activeThreadId)void realtime.start(state.activeThreadId);});
}
async function handleRequests(e){const b=e.target.closest('button[data-request]');if(!b)return;const row=state.friendships.find(r=>r.id===b.dataset.id);if(!row)return;if(b.dataset.request==='accept'){const r=await supabase.from('friendships').update({status:'accepted',updated_at:new Date().toISOString()}).eq('id',row.id);if(r.error)throw r.error;}else{const r=await supabase.from('friendships').delete().eq('id',row.id);if(r.error)throw r.error;}await loadAllChatData();renderRequests();renderBlocked();await renderFriends();renderPeopleResults();}

async function boot(){setupTabs();setupEvents();chatEnhancements.setup();setupChatVoicePlayers();state.settings=readSettings();applySettings();state.user=await getCurrentUserWithRole();if(!state.user){const invite=new URLSearchParams(location.search).get('join');if(invite&&/^[0-9a-f]{64}$/.test(invite)){location.replace('login.html?next='+encodeURIComponent('chat.html?join='+invite));return;}$("chatLayout").dataset.view="auth";$("chatEmptyState").innerHTML='<div class="chat-empty-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-4.5 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></div><h2>Sign in to chat</h2><p>Private conversations are available after you log in.</p><a class="btn" href="login.html?next=chat.html">Log in</a>';return;}const [verifiedResult,preferences,staffPermission]=await Promise.all([
      supabase.from('profiles').select('is_verified,verification_tier,verification_expires_at').eq('id',state.user.id).maybeSingle(),
      loadUserPreferences(state.user),
      supabase.rpc('can_start_staff_dm')
    ]);
    state.verified=Boolean(verifiedLevel(verifiedResult.data));
    document.body.dataset.chatVerified=String(state.verified);
    $("chatVerifiedTranslation").hidden=!state.verified;
    state.settings={...DEFAULT_SETTINGS,...preferences.chat};
    if(!state.verified)state.settings.autoTranslate=false;
    applySettings();
    $("chatTranslateLanguage").value=state.settings.translateLanguage||'en';document.documentElement.dataset.groupTags=preferences.groups?.showMemberTags===false?"hidden":"visible";await loadAllChatData({deferPreviews:true});state.staffDMAllowed=staffPermission.data===true&&!staffPermission.error;renderFriends();renderGroups();renderRequests();renderBlocked();renderPeopleResults();const params=new URLSearchParams(location.search);if(params.get('join'))await joinFromInvitation(params.get('join')).catch(err=>reportAppError(err,'Unable to join group'));else if(params.get('user'))await selectFriend(params.get('user'));else if(params.get('group')&&state.groups.some(g=>g.id===params.get('group')))await selectGroup(params.get('group'));}
boot().catch(err=>{reportAppError(err,'Chat initialization failed');if($("friendList"))$("friendList").innerHTML='<div class="callout" role="alert">Could not load chats. Check your connection and <a href="chat.html">retry</a>.</div>';if($("chatMessages"))$("chatMessages").innerHTML=`<div class="chat-no-messages">Unable to load chats right now. ${escapeHTML(err.message||'Please try again.')}</div>`;});
