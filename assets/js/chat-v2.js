import { supabase, getCurrentUserWithRole, getDisplayName } from "./supabase.js";
import { uploadMedia } from "./media.js";
import { escapeHTML, isSafeUrl, timeAgo, reportAppError } from "./utils.js";

const DEFAULT_AVATAR = "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80";
const DEFAULT_GROUP_AVATAR = "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=200&q=80";
const SETTINGS_KEY = "timzee_chat_settings_v2";
const DEFAULT_SETTINGS = { notifications: true, sounds: true, enterToSend: true, compact: false };
const IMAGE_EXTENSIONS = new Set(["jpg","jpeg","png","gif","webp","bmp","svg","avif","heic","heif"]);
const VIDEO_EXTENSIONS = new Set(["mp4","webm","mov","m4v","mkv","avi","wmv","flv","3gp"]);
const AUDIO_EXTENSIONS = new Set(["mp3","wav","ogg","m4a","aac","flac","opus","webm"]);

const state = {
  user: null, settings: { ...DEFAULT_SETTINGS }, friends: [], friendProfiles: new Map(), friendships: [], requests: [], sentRequests: [], blocked: [],
  blockedProfiles: new Map(), groups: [], groupMembers: new Map(), messages: [], activeThreadId: "", activeFriendId: "", activeGroupId: "",
  channel: null, presence: new Map(), reconnectTimer: null, searchTerm: "", peopleTerm: "", messageSearchTerm: "", mediaFile: null, mediaType: "", previewUrl: "",
  recorder: null, recorderStream: null, recorderChunks: [], recorderTimer: null, recorderStartedAt: 0, analyserFrame: 0, audioContext: null, analyser: null, recordingStarting: false, recordingRequestId: 0
};

const $ = (id) => document.getElementById(id);

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
function saveSettings() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (_) {} }
function defaultSettingsUI() { document.querySelectorAll("[data-chat-setting]").forEach((input) => { input.checked = Boolean(state.settings[input.dataset.chatSetting]); }); }
function setView(view) {
  if (view !== 'chat' && view !== 'info') { stopRecording(false); clearMediaPreview(); }
  const layout = $("chatLayout"); if (layout) layout.dataset.view = view;
  if ($("chatConversation")) $("chatConversation").hidden = view === "list" || view === "info";
  if ($("chatEmptyState")) $("chatEmptyState").hidden = view !== "list";
}
function setHeaderStatus(text, live = false) { if ($("chatStatusText")) $("chatStatusText").textContent = text; if ($("chatLiveDot")) $("chatLiveDot").classList.toggle("is-live", live); }
function closeHeaderMenu() { const menu=$("chatHeaderMenu"); if(menu)menu.hidden=true; $("chatMenuToggle")?.setAttribute("aria-expanded","false"); }
function openHeaderMenu() { const menu=$("chatHeaderMenu"); if(menu)menu.hidden=false; $("chatMenuToggle")?.setAttribute("aria-expanded","true"); }
function profileFor(id) { return state.friendProfiles.get(id) || state.blockedProfiles.get(id) || null; }
function threadForFriend(id) { return [state.user.id,id].sort().join("_"); }
function activeGroup() { return state.groups.find((g)=>g.id===state.activeGroupId) || null; }
function isOwnerOfActiveGroup() { return Boolean(state.activeGroupId && activeGroup()?.created_by===state.user?.id); }

async function loadProfiles(ids) {
  const unique=[...new Set(ids.filter(Boolean))]; if(!unique.length)return;
  const result=await supabase.from("public_profiles").select("*").in("id",unique); if(result.error)throw result.error;
  (result.data||[]).forEach((p)=>state.friendProfiles.set(p.id,p));
}
async function loadAllChatData() {
  const fr=await supabase.from("friendships").select("*").or(`requester_id.eq.${state.user.id},addressee_id.eq.${state.user.id}`); if(fr.error)throw fr.error;
  state.friendships=fr.data||[];
  state.requests=state.friendships.filter(r=>r.status==='pending'&&r.addressee_id===state.user.id);
  state.sentRequests=state.friendships.filter(r=>r.status==='pending'&&r.requester_id===state.user.id);
  state.friends=state.friendships.filter(r=>r.status==='accepted').map(r=>r.requester_id===state.user.id?r.addressee_id:r.requester_id);
  state.blocked=state.friendships.filter(r=>r.status==='blocked'&&r.blocked_by===state.user.id).map(r=>r.requester_id===state.user.id?r.addressee_id:r.requester_id);
  const gr=await supabase.from("chat_members").select("thread_id,tags,is_muted,is_pinned,chat_threads(id,name,is_group,created_by,created_at,avatar_url,description,settings,updated_at)").eq("user_id",state.user.id); if(gr.error)throw gr.error;
  state.groups=(gr.data||[]).map(r=>({...(r.chat_threads||{}),member_tags:r.tags||[],is_muted:r.is_muted,is_pinned:r.is_pinned})).filter(g=>g.id&&g.is_group);
  await loadProfiles([...state.friends,...state.requests.map(r=>r.requester_id),...state.sentRequests.map(r=>r.addressee_id),...state.blocked]);
}
async function loadThreadPreview(threadId) { const result=await supabase.from("direct_messages").select("id,thread_id,body,media_type,created_at,sender_id").eq("thread_id",threadId).order("created_at",{ascending:false}).limit(1).maybeSingle(); return result.data||null; }

async function renderFriends() {
  const target=$("friendList"); if(!target)return;
  const rows=await Promise.all(state.friends.map(async friendId=>({friendId,profile:profileFor(friendId)||{},preview:await loadThreadPreview(threadForFriend(friendId))})));
  const q=state.searchTerm.trim().toLowerCase();
  const filtered=rows.filter(({profile})=>!q||[profile.display_name,profile.username,profile.email].some(v=>String(v||"").toLowerCase().includes(q))).sort((a,b)=>new Date(b.preview?.created_at||0)-new Date(a.preview?.created_at||0));
  target.innerHTML=filtered.length?filtered.map(({friendId,profile,preview})=>`<button class="chat-list-row ${friendId===state.activeFriendId?'active':''}" type="button" data-friend-id="${friendId}"><img class="chat-list-avatar" src="${escapeHTML(profile.avatar_url||DEFAULT_AVATAR)}" alt=""><span class="chat-list-copy"><strong>${escapeHTML(profile.display_name||"Member")}</strong><small>${escapeHTML(preview?.body||(preview?.media_type?`Sent ${preview.media_type}`:'Start a conversation'))}</small></span><span class="chat-list-time">${preview?timeAgo(preview.created_at):''}</span></button>`).join(''):`<div class="callout">${q?'No matching chats.':'No friends yet. Use Find people to connect.'}</div>`;
}
function renderGroups() {
  const target=$("groupList"); if(!target)return; const q=state.searchTerm.trim().toLowerCase();
  const groups=state.groups.filter(g=>!q||String(g.name||'').toLowerCase().includes(q)).sort((a,b)=>Number(b.is_pinned)-Number(a.is_pinned)||new Date(b.updated_at||b.created_at)-new Date(a.updated_at||a.created_at));
  target.innerHTML=groups.length?groups.map(g=>`<button class="chat-list-row ${g.id===state.activeGroupId?'active':''}" type="button" data-group-id="${g.id}"><img class="chat-list-avatar" src="${escapeHTML(g.avatar_url||DEFAULT_GROUP_AVATAR)}" alt=""><span class="chat-list-copy"><strong>${escapeHTML(g.name||'Group')}</strong><small>${escapeHTML(g.description||'Group chat')}</small></span><span class="chat-list-time">${g.is_pinned?'Pinned':''}</span></button>`).join(''):`<div class="callout">No groups yet. Create one to get started.</div>`;
}
function renderRequests() {
  const incoming=$("friendRequests"),outgoing=$("friendRequestsSent"),badge=$("requestsBadge"); if(badge){badge.textContent=String(state.requests.length);badge.hidden=!state.requests.length;}
  const name=id=>escapeHTML(profileFor(id)?.display_name||'Member');
  if(incoming)incoming.innerHTML=state.requests.length?state.requests.map(r=>`<div class="chat-request-row"><img src="${escapeHTML(profileFor(r.requester_id)?.avatar_url||DEFAULT_AVATAR)}" alt=""><div><strong>${name(r.requester_id)}</strong><small>Friend request</small></div><div class="inline-actions"><button class="btn sm" data-request="accept" data-id="${r.id}">Accept</button><button class="btn ghost sm" data-request="decline" data-id="${r.id}">Decline</button></div></div>`).join(''):`<div class="callout">No incoming requests.</div>`;
  if(outgoing)outgoing.innerHTML=state.sentRequests.length?state.sentRequests.map(r=>`<div class="chat-request-row"><img src="${escapeHTML(profileFor(r.addressee_id)?.avatar_url||DEFAULT_AVATAR)}" alt=""><div><strong>${name(r.addressee_id)}</strong><small>Request sent</small></div><button class="btn ghost sm" data-request="cancel" data-id="${r.id}">Cancel</button></div>`).join(''):`<div class="callout">No outgoing requests.</div>`;
}
function renderBlocked() { const target=$("blockedList"); if(!target)return; target.innerHTML=state.blocked.length?state.blocked.map(id=>`<div class="chat-request-row"><img src="${escapeHTML(profileFor(id)?.avatar_url||DEFAULT_AVATAR)}" alt=""><div><strong>${escapeHTML(profileFor(id)?.display_name||'Member')}</strong><small>Blocked</small></div><button class="btn ghost sm" data-unblock="${id}">Unblock</button></div>`).join(''):`<div class="callout">No blocked users.</div>`; }
function renderPeopleResults() {
  const target=$("peopleResults"); if(!target)return; const q=state.peopleTerm.trim().toLowerCase(); if(!q){target.innerHTML='<div class="callout">Search by name, username or email.</div>';return;}
  const profiles=[...state.friendProfiles.values()].filter(p=>p.id!==state.user.id&&[p.display_name,p.username,p.email].some(v=>String(v||'').toLowerCase().includes(q)));
  target.innerHTML=profiles.length?profiles.slice(0,20).map(p=>{const f=state.friendships.find(r=>(r.requester_id===state.user.id&&r.addressee_id===p.id)||(r.addressee_id===state.user.id&&r.requester_id===p.id));const friend=f?.status==='accepted';const pending=f?.status==='pending';const blocked=f?.status==='blocked';return `<div class="chat-request-row"><img src="${escapeHTML(p.avatar_url||DEFAULT_AVATAR)}" alt=""><div><strong>${escapeHTML(p.display_name||p.username||'Member')}</strong><small>${escapeHTML(p.username||p.email||'')}</small></div><button class="btn ghost sm" data-people-action="${friend?'message':'request'}" data-id="${p.id}" ${pending||blocked?'disabled':''}>${friend?'Message':blocked?'Blocked':pending?'Requested':'Add friend'}</button></div>`}).join(''):`<div class="callout">No users found.</div>`;
}

async function loadMessages(threadId) { const result=await supabase.from('direct_messages').select('*').eq('thread_id',threadId).order('created_at',{ascending:true}); if(result.error)throw result.error; state.messages=result.data||[]; await loadProfiles(state.messages.map(m=>m.sender_id)); renderMessages(); }
function messageMediaHtml(m) { const url=m.media_url&&isSafeUrl(m.media_url)?m.media_url:''; if(!url)return ''; const type=resolveAttachmentType({mediaType:m.media_type,mediaUrl:url}); if(type==='image')return `<img class="message-attachment-image" src="${escapeHTML(url)}" alt="Message attachment" loading="lazy">`; if(type==='video')return `<video class="message-attachment-video" controls preload="metadata" src="${escapeHTML(url)}"></video>`; if(type==='audio')return `<div class="message-voice"><div class="message-voice-mark"><span></span><span></span><span></span><span></span><span></span></div><audio controls preload="metadata" src="${escapeHTML(url)}"></audio></div>`; return `<a class="message-file" href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer" download><strong>${escapeHTML(getDisplayFileName(url))}</strong><small>${escapeHTML(m.media_type||'File')} · Open or download</small></a>`; }
function renderMessages() { const target=$("chatMessages"); if(!target)return; const q=state.messageSearchTerm.trim().toLowerCase(); const msgs=q?state.messages.filter(m=>String(m.body||'').toLowerCase().includes(q)):state.messages; if(!msgs.length){target.innerHTML=`<div class="chat-no-messages">${q?'No messages match your search.':'No messages yet. Start the conversation.'}</div>`;return;} target.innerHTML=msgs.map(m=>{const self=m.sender_id===state.user.id;const p=profileFor(m.sender_id)||{};const body=m.body?escapeHTML(m.body).replace(/\n/g,'<br>'):'';return `<article class="chat-message ${self?'self':'received'}" data-message-id="${m.id}">${!self&&state.activeGroupId?`<div class="chat-message-author">${escapeHTML(p.display_name||'Member')}</div>`:''}${body?`<div class="chat-message-body">${body}</div>`:''}${messageMediaHtml(m)}<div class="chat-message-meta"><span>${timeAgo(m.created_at)}</span></div></article>`}).join(''); target.scrollTop=target.scrollHeight; }
function renderInfoMedia(){const grid=$("infoMediaGrid");if(!grid)return;const items=state.messages.filter(m=>{const t=resolveAttachmentType({mediaType:m.media_type,mediaUrl:m.media_url});return isSafeUrl(m.media_url||'')&&['image','video'].includes(t)}).slice(-18).reverse();grid.innerHTML=items.length?items.map(m=>{const t=resolveAttachmentType({mediaType:m.media_type,mediaUrl:m.media_url});return t==='video'?`<a href="${escapeHTML(m.media_url)}" target="_blank" rel="noopener noreferrer"><video src="${escapeHTML(m.media_url)}" muted preload="metadata"></video></a>`:`<a href="${escapeHTML(m.media_url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeHTML(m.media_url)}" alt="Shared media" loading="lazy"></a>`}).join(''):`<div class="callout">No media shared yet.</div>`;}
async function loadGroupMembers(threadId){const result=await supabase.from('chat_members').select('id,user_id,role,tags,is_muted,is_pinned,last_read_at').eq('thread_id',threadId);if(result.error)throw result.error;const members=result.data||[];await loadProfiles(members.map(m=>m.user_id));state.groupMembers.set(threadId,members);renderGroupMembers();}
function renderGroupMembers(){const target=$("infoGroupMembers"),section=$("groupMembersSection");if(!target||!section||!state.activeGroupId)return;const members=state.groupMembers.get(state.activeGroupId)||[];section.hidden=false;$("groupMemberCount").textContent=String(members.length);const owner=isOwnerOfActiveGroup();target.innerHTML=members.map(m=>{const p=profileFor(m.user_id)||{};const tags=Array.isArray(m.tags)?m.tags:[];return `<div class="group-member-row"><img class="chat-member-avatar" src="${escapeHTML(p.avatar_url||DEFAULT_AVATAR)}" alt=""><div class="group-member-copy"><strong>${escapeHTML(p.display_name||'Member')}${m.role==='owner'?' · Owner':''}</strong><div class="member-tag-list">${tags.map(tag=>`<span class="member-tag">${escapeHTML(tag)}</span>`).join('')||'<span class="member-tag muted">No tag</span>'}</div></div>${owner?`<button class="btn ghost sm" data-edit-member-tags="${m.id}" type="button">Edit tag</button>`:''}</div>`}).join('');}
function updateHeaderForFriend(id){const p=profileFor(id)||{};$("chatAvatar").src=p.avatar_url||DEFAULT_AVATAR;$("chatName").textContent=p.display_name||'Member';$("chatProfileBtn").href=`profile.html?id=${encodeURIComponent(id)}`;$("directInfoActions").hidden=false;$("groupInfoSection").hidden=true;$("groupMembersSection").hidden=true;$("infoPanelTitle").textContent='Chat details';}
function updateHeaderForGroup(g){$("chatAvatar").src=g.avatar_url||DEFAULT_GROUP_AVATAR;$("chatName").textContent=g.name||'Group';$("directInfoActions").hidden=true;$("groupInfoSection").hidden=false;$("groupMembersSection").hidden=false;$("infoPanelTitle").textContent='Group details';}
async function selectFriend(id){await unsubscribeRealtime();state.activeFriendId=id;state.activeGroupId='';state.activeThreadId=threadForFriend(id);updateHeaderForFriend(id);await loadMessages(state.activeThreadId);await subscribeRealtime();setView('chat');setHeaderStatus('Live chat',true);await renderFriends();renderGroups();renderInfoMedia();}
async function selectGroup(id){await unsubscribeRealtime();state.activeGroupId=id;state.activeFriendId='';state.activeThreadId=id;const g=activeGroup();if(!g)return;updateHeaderForGroup(g);await loadMessages(id);await loadGroupMembers(id);await subscribeRealtime();setView('chat');setHeaderStatus('Live group chat',true);await renderFriends();renderGroups();renderInfoMedia();}
async function unsubscribeRealtime(){if(state.channel){try{await supabase.removeChannel(state.channel);}catch(_){}state.channel=null;}state.presence.clear();if(state.reconnectTimer){clearTimeout(state.reconnectTimer);state.reconnectTimer=null;}}
function scheduleReconnect(){if(!state.activeThreadId||state.reconnectTimer)return;setHeaderStatus('Reconnecting…',false);state.reconnectTimer=setTimeout(async()=>{state.reconnectTimer=null;try{await subscribeRealtime();}catch(_){scheduleReconnect();}},1500);}
async function subscribeRealtime(){const threadId=state.activeThreadId;if(!threadId)return;const channel=supabase.channel(`timzee-chat-${threadId}-${crypto.randomUUID()}`);state.channel=channel;channel.on('postgres_changes',{event:'INSERT',schema:'public',table:'direct_messages',filter:`thread_id=eq.${threadId}`},async payload=>{const m=payload.new;if(!m||state.messages.some(x=>x.id===m.id))return;state.messages.push(m);await loadProfiles([m.sender_id]);renderMessages();renderInfoMedia();if(m.sender_id!==state.user.id&&state.settings.notifications)window.siteToast?.(`${profileFor(m.sender_id)?.display_name||'New message'}: ${m.body||'Attachment'}`,{type:'info',title:'New message'});}).on('broadcast',{event:'typing'},payload=>{const p=payload.payload||{};if(p.userId!==state.user.id)showTyping(p.name||'Someone',Boolean(p.typing));}).on('presence',{event:'sync'},()=>{const ps=channel.presenceState();state.presence.clear();Object.values(ps).flat().forEach(e=>state.presence.set(e.user_id,e));refreshPresenceText();});const status=await new Promise(resolve=>{let done=false;const timer=setTimeout(()=>{if(!done){done=true;resolve('TIMED_OUT');}},9000);channel.subscribe(v=>{if(['SUBSCRIBED','CHANNEL_ERROR','TIMED_OUT'].includes(v)&&!done){done=true;clearTimeout(timer);resolve(v);}});});if(status!=='SUBSCRIBED'){scheduleReconnect();return;}await channel.track({user_id:state.user.id,name:getDisplayName(state.user),at:Date.now()});setHeaderStatus(state.activeGroupId?'Live group chat':'Live chat',true);}
function refreshPresenceText(){if(state.activeGroupId){const online=[...state.presence.keys()].filter(id=>id!==state.user.id).length;setHeaderStatus(online?`${online} online · Live`:'Live group chat',true);}else setHeaderStatus(state.presence.has(state.activeFriendId)?'Online · Live':'Live chat',true);}
function showTyping(name,active){const box=$("chatTyping");if(!box)return;box.hidden=!active;$("chatTypingName").textContent=name;clearTimeout(box._typingTimer);if(active)box._typingTimer=setTimeout(()=>{box.hidden=true;},2400);}
function broadcastTyping(typing){if(state.channel)void state.channel.send({type:'broadcast',event:'typing',payload:{userId:state.user.id,name:getDisplayName(state.user),typing}});}
function clearMediaPreview(){if(state.previewUrl)URL.revokeObjectURL(state.previewUrl);state.previewUrl='';state.mediaFile=null;state.mediaType='';if($("chatMediaPreview"))$("chatMediaPreview").innerHTML='';}
function showMediaPreview(file){clearMediaPreview();state.mediaFile=file;state.mediaType=resolveAttachmentType({mimeType:file.type,fileName:file.name});state.previewUrl=URL.createObjectURL(file);let c=state.mediaType==='image'?`<img src="${escapeHTML(state.previewUrl)}" alt="Attachment preview">`:state.mediaType==='video'?`<video controls src="${escapeHTML(state.previewUrl)}"></video>`:state.mediaType==='audio'?`<div class="voice-preview"><div class="voice-preview-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><audio controls src="${escapeHTML(state.previewUrl)}"></audio></div>`:`<div class="media-preview-file"><strong>${escapeHTML(file.name)}</strong><small>${escapeHTML(file.type||'File')} · ${escapeHTML(formatFileSize(file.size))}</small></div>`;$("chatMediaPreview").innerHTML=`${c}<button class="btn ghost sm" id="removeChatMedia" type="button">Remove</button>`;$("removeChatMedia")?.addEventListener('click',clearMediaPreview);}
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
    state.recorder=new MediaRecorder(stream);
    state.recorderStartedAt=Date.now();
    $("voiceWaveform").innerHTML=Array.from({length:40},(_,i)=>`<span data-wave="${i}"></span>`).join('');
    $("voiceRecordingSheet").hidden=false;
    animateWaveform();
    state.recorder.ondataavailable=e=>{if(e.data.size)state.recorderChunks.push(e.data);};
    state.recorder.onstop=()=>{
      const blob=new Blob(state.recorderChunks,{type:state.recorder?.mimeType||'audio/webm'});
      if(blob.size)showMediaPreview(new File([blob],`voice-${Date.now()}.webm`,{type:blob.type}));
      stopRecorderTracks();
    };
    state.recorder.start(120);
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
async function sendMessage(){const body=($("chatBody").value||'').trim();if(!state.activeThreadId||(!body&&!state.mediaFile))return;let mediaUrl='';if(state.mediaFile)mediaUrl=await uploadMedia(state.mediaFile,'direct-messages');const payload={id:crypto.randomUUID(),thread_id:state.activeThreadId,sender_id:state.user.id,recipient_id:state.activeFriendId||null,body,media_url:mediaUrl,media_type:state.mediaType||'',created_at:new Date().toISOString()};const result=await supabase.from('direct_messages').insert(payload).select().single();if(result.error)throw result.error;const saved=result.data||payload;if(!state.messages.some(m=>m.id===saved.id))state.messages.push(saved);renderMessages();renderInfoMedia();$("chatBody").value='';$("chatBody").style.height='auto';clearMediaPreview();broadcastTyping(false);await renderFriends();renderGroups();}
function openModal(id){$(id)?.removeAttribute('hidden');document.body.classList.add('modal-open');}
function closeModal(id){$(id)?.setAttribute('hidden','');document.body.classList.remove('modal-open');}
function renderGroupPicker(){const target=$("groupMemberPicker");if(!target)return;target.innerHTML=state.friends.map(id=>{const p=profileFor(id)||{};return `<label class="chat-picker-row"><input type="checkbox" value="${id}"><img src="${escapeHTML(p.avatar_url||DEFAULT_AVATAR)}" alt=""><span><strong>${escapeHTML(p.display_name||'Member')}</strong><small>${escapeHTML(p.username||'')}</small></span></label>`}).join('');$("groupPickerEmpty").hidden=state.friends.length!==0;}
async function createGroup(){const name=($("newGroupName").value||'').trim();const selected=[...document.querySelectorAll('#groupMemberPicker input:checked')].map(i=>i.value);if(!name)throw new Error('Enter a group name.');if(!selected.length)throw new Error('Choose at least one friend.');const id=crypto.randomUUID(),now=new Date().toISOString();const thread=await supabase.from('chat_threads').insert({id,name,is_group:true,created_by:state.user.id,created_at:now,updated_at:now,settings:{}}).select().single();if(thread.error)throw thread.error;const members=[...new Set([state.user.id,...selected])].map(user_id=>({id:crypto.randomUUID(),thread_id:id,user_id,role:user_id===state.user.id?'owner':'member',joined_at:now,tags:[]}));const result=await supabase.from('chat_members').insert(members);if(result.error){await supabase.from('chat_threads').delete().eq('id',id);throw result.error;}closeModal('friendPickerModal');await loadAllChatData();renderGroups();await selectGroup(id);}
async function editGroup(){const group=activeGroup();if(!group||!isOwnerOfActiveGroup())return;const patch={name:($("groupNameInput").value||'').trim().slice(0,80),description:($("groupDescriptionInput").value||'').trim().slice(0,300),updated_at:new Date().toISOString()};if(!patch.name)throw new Error('Group name is required.');if($("groupAvatarInput")?.files?.[0])patch.avatar_url=await uploadMedia($("groupAvatarInput").files[0],`group-avatars/${state.user.id}`);const result=await supabase.from('chat_threads').update(patch).eq('id',group.id).eq('created_by',state.user.id);if(result.error)throw result.error;Object.assign(group,patch);updateHeaderForGroup(group);renderGroups();$("groupEditor").hidden=true;}
async function editMemberTags(memberId){if(!isOwnerOfActiveGroup())return;const member=(state.groupMembers.get(state.activeGroupId)||[]).find(m=>m.id===memberId);if(!member)return;const raw=window.prompt('Member tags for this group, separated by commas:',(member.tags||[]).join(', '));if(raw===null)return;const tags=[...new Set(raw.split(',').map(t=>t.trim()).filter(Boolean).slice(0,8))];const result=await supabase.from('chat_members').update({tags}).eq('id',memberId).eq('thread_id',state.activeGroupId);if(result.error)throw result.error;member.tags=tags;renderGroupMembers();}
async function toggleChatMemberFlag(kind){const threadId=state.activeThreadId;if(!threadId)return;const existing=await supabase.from('chat_members').select('is_muted,is_pinned').eq('thread_id',threadId).eq('user_id',state.user.id).maybeSingle();if(existing.error)throw existing.error;if(!existing.data){window.siteToast?.('Pin and mute settings are currently available for group memberships.',{type:'info',title:'Chat'});return;}const key=kind==='mute'?'is_muted':'is_pinned';const next=!Boolean(existing.data[key]);const result=await supabase.from('chat_members').update({[key]:next}).eq('thread_id',threadId).eq('user_id',state.user.id);if(result.error)throw result.error;const group=activeGroup();if(group)group[key]=next;renderGroups();window.siteToast?.(`${kind==='mute'?'Notifications':'Chat'} ${next?'updated':'restored'}.`,{type:'info',title:'Chat'});}
function setupTabs(){const tabs=document.querySelectorAll('.chat-tab'),panels=document.querySelectorAll('.chat-tab-panel');tabs.forEach(tab=>tab.addEventListener('click',()=>{tabs.forEach(t=>{const a=t===tab;t.classList.toggle('active',a);t.setAttribute('aria-selected',String(a));});panels.forEach(p=>p.hidden=p.dataset.panel!==tab.dataset.tab);$("peopleSearchPanel").hidden=true;}));}
function setupEvents(){
  $("chatSearch")?.addEventListener('input',async e=>{state.searchTerm=e.target.value||'';await renderFriends();renderGroups();}); $("peopleSearch")?.addEventListener('input',e=>{state.peopleTerm=e.target.value||'';renderPeopleResults();});
  $("friendList")?.addEventListener('click',e=>{const r=e.target.closest('[data-friend-id]');if(r)selectFriend(r.dataset.friendId).catch(err=>reportAppError(err,'Chat open failed'));}); $("groupList")?.addEventListener('click',e=>{const r=e.target.closest('[data-group-id]');if(r)selectGroup(r.dataset.groupId).catch(err=>reportAppError(err,'Group open failed'));});
  $("friendRequests")?.addEventListener('click',handleRequests); $("friendRequestsSent")?.addEventListener('click',handleRequests);
  $("blockedList")?.addEventListener('click',async e=>{const b=e.target.closest('[data-unblock]');if(!b)return;const row=state.friendships.find(r=>r.status==='blocked'&&r.blocked_by===state.user.id&&(r.requester_id===b.dataset.unblock||r.addressee_id===b.dataset.unblock));if(row)await supabase.from('friendships').delete().eq('id',row.id);await loadAllChatData();renderBlocked();await renderFriends();});
  $("peopleResults")?.addEventListener('click',async e=>{const b=e.target.closest('button[data-people-action]');if(!b||b.disabled)return;if(b.dataset.peopleAction==='message')await selectFriend(b.dataset.id);else{const r=await supabase.from('friendships').insert({id:crypto.randomUUID(),requester_id:state.user.id,requester_name:getDisplayName(state.user),addressee_id:b.dataset.id,status:'pending',created_at:new Date().toISOString()});if(r.error)throw r.error;await loadAllChatData();renderPeopleResults();renderRequests();}});
  $("chatBody")?.addEventListener('input',()=>{const t=$("chatBody");t.style.height='auto';t.style.height=`${Math.min(t.scrollHeight,140)}px`;broadcastTyping(true);clearTimeout(t._typingTimer);t._typingTimer=setTimeout(()=>broadcastTyping(false),900);});
  $("chatBody")?.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&state.settings.enterToSend){e.preventDefault();sendMessage().catch(err=>reportAppError(err,'Message send failed'));}}); $("chatForm")?.addEventListener('submit',e=>{e.preventDefault();sendMessage().catch(err=>reportAppError(err,'Message send failed'));});
  $("chatMedia")?.addEventListener('change',e=>{const f=e.target.files?.[0];if(f)showMediaPreview(f);e.target.value='';});
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
  $("chatBackBtn")?.addEventListener('click',async()=>{await unsubscribeRealtime();setView('list');}); $("chatInfoToggle")?.addEventListener('click',()=>{$("chatInfoPanel").classList.add('open');$("chatInfoBackdrop").hidden=false;}); $("chatInfoClose")?.addEventListener('click',()=>{$("chatInfoPanel").classList.remove('open');$("chatInfoBackdrop").hidden=true;}); $("chatInfoBackdrop")?.addEventListener('click',()=>{$("chatInfoPanel").classList.remove('open');$("chatInfoBackdrop").hidden=true;});
  $("chatMenuToggle")?.addEventListener('click',e=>{e.stopPropagation();$("chatHeaderMenu").hidden?openHeaderMenu():closeHeaderMenu();}); document.addEventListener('click',e=>{if(!e.target.closest('.chat-header-actions'))closeHeaderMenu();});
  $("chatHeaderMenu")?.addEventListener('click',async e=>{const a=e.target.closest('[data-chat-menu]')?.dataset.chatMenu;if(!a)return;closeHeaderMenu();if(a==='search'){state.messageSearchTerm=window.prompt('Search in this chat:',state.messageSearchTerm)||'';renderMessages();}if(a==='settings'){defaultSettingsUI();openModal('chatSettingsModal');}if(a==='mute'||a==='pin')await toggleChatMemberFlag(a);if(a==='report')location.href='contact.html?subject='+encodeURIComponent('Chat report');});
  document.querySelectorAll('[data-close-modal]').forEach(b=>b.addEventListener('click',()=>closeModal(b.dataset.closeModal))); document.querySelectorAll('[data-chat-setting]').forEach(i=>i.addEventListener('change',()=>{state.settings[i.dataset.chatSetting]=i.checked;saveSettings();}));
  $("peopleSearchToggle")?.addEventListener('click',()=>{$("peopleSearchPanel").hidden=!$("peopleSearchPanel").hidden;if(!$("peopleSearchPanel").hidden){$("peopleSearch").focus();renderPeopleResults();}}); $("newGroupBtn")?.addEventListener('click',()=>{renderGroupPicker();openModal('friendPickerModal');}); $("friendPickerClose")?.addEventListener('click',()=>closeModal('friendPickerModal')); $("friendPickerCancel")?.addEventListener('click',()=>closeModal('friendPickerModal')); $("friendPickerCreate")?.addEventListener('click',()=>createGroup().catch(err=>window.siteToast?.(err.message,{type:'error',title:'Create group'})));
  $("groupMemberSearch")?.addEventListener('input',e=>{const q=e.target.value.trim().toLowerCase();document.querySelectorAll('#groupMemberPicker .chat-picker-row').forEach(r=>r.hidden=!r.innerText.toLowerCase().includes(q));}); $("editGroupBtn")?.addEventListener('click',()=>{const g=activeGroup();if(g){$("groupAvatarPreview").src=g.avatar_url||DEFAULT_GROUP_AVATAR;$("groupNameInput").value=g.name||'';$("groupDescriptionInput").value=g.description||'';$("groupEditor").hidden=false;}}); $("groupAvatarInput")?.addEventListener('change',e=>{const f=e.target.files?.[0];if(f)$("groupAvatarPreview").src=URL.createObjectURL(f);}); $("cancelGroupBtn")?.addEventListener('click',()=>{$("groupEditor").hidden=true;}); $("saveGroupBtn")?.addEventListener('click',()=>editGroup().catch(err=>window.siteToast?.(err.message,{type:'error',title:'Group settings'}))); $("infoGroupMembers")?.addEventListener('click',e=>{const b=e.target.closest('[data-edit-member-tags]');if(b)editMemberTags(b.dataset.editMemberTags).catch(err=>window.siteToast?.(err.message,{type:'error',title:'Member tag'}));});
  window.addEventListener('online',()=>{if(state.activeThreadId)scheduleReconnect();}); window.addEventListener('offline',()=>{if(state.activeThreadId)setHeaderStatus('Offline',false);});
}
async function handleRequests(e){const b=e.target.closest('button[data-request]');if(!b)return;const row=state.friendships.find(r=>r.id===b.dataset.id);if(!row)return;if(b.dataset.request==='accept'){const r=await supabase.from('friendships').update({status:'accepted',updated_at:new Date().toISOString()}).eq('id',row.id);if(r.error)throw r.error;}else{const r=await supabase.from('friendships').delete().eq('id',row.id);if(r.error)throw r.error;}await loadAllChatData();renderRequests();renderBlocked();await renderFriends();renderPeopleResults();}

async function boot(){setupTabs();setupEvents();state.settings=readSettings();defaultSettingsUI();state.user=await getCurrentUserWithRole();if(!state.user){$("chatEmptyState").innerHTML='<div class="chat-empty-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-4.5 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></div><h2>Sign in to chat</h2><p>Private conversations are available after you log in.</p><a class="btn" href="login.html?next=chat.html">Log in</a>';return;}await loadAllChatData();await renderFriends();renderGroups();renderRequests();renderBlocked();renderPeopleResults();const params=new URLSearchParams(location.search);if(params.get('user')&&state.friends.includes(params.get('user')))await selectFriend(params.get('user'));else if(params.get('group')&&state.groups.some(g=>g.id===params.get('group')))await selectGroup(params.get('group'));}
boot().catch(err=>{reportAppError(err,'Chat initialization failed');if($("chatMessages"))$("chatMessages").innerHTML=`<div class="chat-no-messages">Unable to load chats right now. ${escapeHTML(err.message||'Please try again.')}</div>`;});
