import { supabase, getCurrentUserWithRole, getDisplayName } from "./supabase.js";
import { uploadMedia } from "./media.js";
import { escapeHTML, isSafeUrl, resolveAttachmentType, getDisplayFileName, formatFileSize, timeAgo, reportAppError } from "./utils.js";

const DEFAULT_AVATAR = "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80";
const DEFAULT_GROUP_AVATAR = "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=200&q=80";
const SETTINGS_KEY = "timzee_chat_settings_v2";
const DEFAULT_SETTINGS = {
  notifications: true,
  sounds: true,
  enterToSend: true,
  compact: false
};

const state = {
  user: null,
  settings: { ...DEFAULT_SETTINGS },
  friends: [],
  friendProfiles: new Map(),
  friendships: [],
  requests: [],
  sentRequests: [],
  blocked: [],
  blockedProfiles: new Map(),
  groups: [],
  groupMembers: new Map(),
  messages: [],
  activeThreadId: "",
  activeFriendId: "",
  activeGroupId: "",
  channel: null,
  presence: new Map(),
  reconnectTimer: null,
  searchTerm: "",
  peopleTerm: "",
  messageSearchTerm: "",
  mediaFile: null,
  mediaType: "",
  previewUrl: "",
  recorder: null,
  recorderStream: null,
  recorderChunks: [],
  recorderTimer: null,
  recorderStartedAt: 0,
  analyserFrame: 0,
  audioContext: null,
  analyser: null
};

const $ = (id) => document.getElementById(id);

function readSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch (_) {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch (_) {}
}

function defaultSettingsUI() {
  document.querySelectorAll("[data-chat-setting]").forEach((input) => {
    const key = input.dataset.chatSetting;
    input.checked = Boolean(state.settings[key]);
  });
}

function setView(view) {
  const layout = $("chatLayout");
  if (layout) layout.dataset.view = view;
  const conversation = $("chatConversation");
  const empty = $("chatEmptyState");
  if (conversation) conversation.hidden = view === "list" || view === "info";
  if (empty) empty.hidden = view !== "list";
}

function setHeaderStatus(text, live = false) {
  const status = $("chatStatusText");
  const dot = $("chatLiveDot");
  if (status) status.textContent = text;
  if (dot) dot.classList.toggle("is-live", live);
}

function closeHeaderMenu() {
  const menu = $("chatHeaderMenu");
  const button = $("chatMenuToggle");
  if (menu) menu.hidden = true;
  if (button) button.setAttribute("aria-expanded", "false");
}

function openHeaderMenu() {
  const menu = $("chatHeaderMenu");
  const button = $("chatMenuToggle");
  if (!menu) return;
  menu.hidden = false;
  if (button) button.setAttribute("aria-expanded", "true");
}

function profileFor(userId) {
  return state.friendProfiles.get(userId) || state.blockedProfiles.get(userId) || null;
}

function threadForFriend(friendId) {
  const pair = [state.user.id, friendId].sort();
  return `${pair[0]}_${pair[1]}`;
}

function activeGroup() {
  return state.groups.find((group) => group.id === state.activeGroupId) || null;
}

function isOwnerOfActiveGroup() {
  return Boolean(state.activeGroupId && activeGroup()?.created_by === state.user?.id);
}

function escapeSelector(value) {
  return String(value).replace(/"/g, "&quot;");
}

async function loadProfiles(ids) {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return;
  const result = await supabase.from("profiles").select("*").in("id", unique);
  if (result.error) throw result.error;
  (result.data || []).forEach((profile) => state.friendProfiles.set(profile.id, profile));
}

async function loadAllChatData() {
  const friendsResult = await supabase
    .from("friendships")
    .select("*")
    .or(`requester_id.eq.${state.user.id},addressee_id.eq.${state.user.id}`);
  if (friendsResult.error) throw friendsResult.error;
  state.friendships = friendsResult.data || [];
  state.requests = state.friendships.filter((row) => row.status === "pending" && row.addressee_id === state.user.id);
  state.sentRequests = state.friendships.filter((row) => row.status === "pending" && row.requester_id === state.user.id);
  state.friends = state.friendships
    .filter((row) => row.status === "accepted")
    .map((row) => row.requester_id === state.user.id ? row.addressee_id : row.requester_id);
  state.blocked = state.friendships
    .filter((row) => row.status === "blocked" && row.blocked_by === state.user.id)
    .map((row) => row.requester_id === state.user.id ? row.addressee_id : row.requester_id);

  const groupResult = await supabase
    .from("chat_members")
    .select("thread_id,tags,is_muted,is_pinned,chat_threads(id,name,is_group,created_by,created_at,avatar_url,description,settings,updated_at)")
    .eq("user_id", state.user.id);
  if (groupResult.error) throw groupResult.error;
  state.groups = (groupResult.data || [])
    .map((row) => ({ ...(row.chat_threads || {}), member_tags: row.tags || [], is_muted: row.is_muted, is_pinned: row.is_pinned }))
    .filter((row) => row.id && row.is_group);

  const profileIds = [...state.friends, ...state.requests.map((row) => row.requester_id), ...state.sentRequests.map((row) => row.addressee_id), ...state.blocked];
  await loadProfiles(profileIds);
}

async function loadThreadPreview(threadId) {
  const result = await supabase
    .from("direct_messages")
    .select("id,thread_id,body,media_type,created_at,sender_id")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return result.data || null;
}

async function loadMessages(threadId) {
  const result = await supabase
    .from("direct_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  if (result.error) throw result.error;
  state.messages = result.data || [];
  const ids = state.messages.map((message) => message.sender_id);
  await loadProfiles(ids);
  renderMessages();
}

async function buildFriendRows() {
  const rows = await Promise.all(state.friends.map(async (friendId) => ({
    friendId,
    profile: profileFor(friendId) || {},
    preview: await loadThreadPreview(threadForFriend(friendId))
  })));
  return rows.sort((a, b) => {
    const ap = a.preview?.created_at || "";
    const bp = b.preview?.created_at || "";
    return new Date(bp) - new Date(ap);
  });
}

function renderRequests() {
  const incoming = $("friendRequests");
  const outgoing = $("friendRequestsSent");
  const badge = $("requestsBadge");
  if (badge) {
    badge.textContent = String(state.requests.length);
    badge.hidden = state.requests.length === 0;
  }
  const profileName = (id) => escapeHTML(profileFor(id)?.display_name || "Member");
  if (incoming) incoming.innerHTML = state.requests.length
    ? state.requests.map((row) => `<div class="chat-request-row"><img src="${escapeSelector(profileFor(row.requester_id)?.avatar_url || DEFAULT_AVATAR)}" alt=""><div><strong>${profileName(row.requester_id)}</strong><small>Friend request</small></div><div class="inline-actions"><button class="btn sm" data-request="accept" data-id="${row.id}">Accept</button><button class="btn ghost sm" data-request="decline" data-id="${row.id}">Decline</button></div></div>`).join("")
    : `<div class="callout">No incoming requests.</div>`;
  if (outgoing) outgoing.innerHTML = state.sentRequests.length
    ? state.sentRequests.map((row) => `<div class="chat-request-row"><img src="${escapeSelector(profileFor(row.addressee_id)?.avatar_url || DEFAULT_AVATAR)}" alt=""><div><strong>${profileName(row.addressee_id)}</strong><small>Request sent</small></div><button class="btn ghost sm" data-request="cancel" data-id="${row.id}">Cancel</button></div>`).join("")
    : `<div class="callout">No outgoing requests.</div>`;
}

function renderBlocked() {
  const target = $("blockedList");
  if (!target) return;
  if (!state.blocked.length) {
    target.innerHTML = `<div class="callout">No blocked users.</div>`;
    return;
  }
  target.innerHTML = state.blocked.map((id) => `<div class="chat-request-row"><img src="${escapeSelector(profileFor(id)?.avatar_url || DEFAULT_AVATAR)}" alt=""><div><strong>${escapeHTML(profileFor(id)?.display_name || "Member")}</strong><small>Blocked</small></div><button class="btn ghost sm" data-unblock="${id}">Unblock</button></div>`).join("");
}

async function renderFriends() {
  const target = $("friendList");
  if (!target) return;
  const rows = await buildFriendRows();
  const query = state.searchTerm.trim().toLowerCase();
  const filtered = rows.filter(({ profile }) => !query || [profile.display_name, profile.username, profile.email].some((v) => String(v || "").toLowerCase().includes(query)));
  if (!filtered.length) {
    target.innerHTML = `<div class="callout">${query ? "No matching chats." : "No friends yet. Use Find people to connect."}</div>`;
    return;
  }
  target.innerHTML = filtered.map(({ friendId, profile, preview }) => {
    const previewText = preview ? (preview.body || (preview.media_type ? `Sent ${preview.media_type}` : "Attachment")) : "Start a conversation";
    return `<button class="chat-list-row ${friendId === state.activeFriendId ? "active" : ""}" type="button" data-friend-id="${friendId}">
      <img class="chat-list-avatar" src="${escapeSelector(profile.avatar_url || DEFAULT_AVATAR)}" alt="">
      <span class="chat-list-copy"><strong>${escapeHTML(profile.display_name || "Member")}</strong><small>${escapeHTML(previewText)}</small></span>
      <span class="chat-list-time">${preview ? timeAgo(preview.created_at) : ""}</span>
    </button>`;
  }).join("");
}

function renderGroups() {
  const target = $("groupList");
  if (!target) return;
  const query = state.searchTerm.trim().toLowerCase();
  const groups = state.groups
    .filter((group) => !query || String(group.name || "").toLowerCase().includes(query))
    .sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned) || new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at));
  target.innerHTML = groups.length
    ? groups.map((group) => `<button class="chat-list-row ${group.id === state.activeGroupId ? "active" : ""}" type="button" data-group-id="${group.id}"><img class="chat-list-avatar" src="${escapeSelector(group.avatar_url || DEFAULT_GROUP_AVATAR)}" alt=""><span class="chat-list-copy"><strong>${escapeHTML(group.name || "Group")}</strong><small>${escapeHTML(group.description || "Group chat")}</small></span><span class="chat-list-time">${group.is_pinned ? "Pinned" : ""}</span></button>`).join("")
    : `<div class="callout">No groups yet. Create one to get started.</div>`;
}

function renderPeopleResults() {
  const target = $("peopleResults");
  if (!target) return;
  const q = state.peopleTerm.trim().toLowerCase();
  if (!q) {
    target.innerHTML = `<div class="callout">Search by name, username or email.</div>`;
    return;
  }
  const profiles = [...state.friendProfiles.values()].filter((profile) => profile.id !== state.user.id && [profile.display_name, profile.username, profile.email].some((v) => String(v || "").toLowerCase().includes(q)));
  if (!profiles.length) {
    target.innerHTML = `<div class="callout">No users found.</div>`;
    return;
  }
  target.innerHTML = profiles.slice(0, 20).map((profile) => {
    const friendship = state.friendships.find((row) => (row.requester_id === state.user.id && row.addressee_id === profile.id) || (row.addressee_id === state.user.id && row.requester_id === profile.id));
    const friend = friendship?.status === "accepted";
    const pending = friendship?.status === "pending";
    const blocked = friendship?.status === "blocked";
    const label = friend ? "Message" : blocked ? "Blocked" : pending ? "Requested" : "Add friend";
    return `<div class="chat-request-row"><img src="${escapeSelector(profile.avatar_url || DEFAULT_AVATAR)}" alt=""><div><strong>${escapeHTML(profile.display_name || profile.username || "Member")}</strong><small>${escapeHTML(profile.username || profile.email || "")}</small></div><button class="btn ghost sm" data-people-action="${friend ? "message" : "request"}" data-id="${profile.id}" ${pending || blocked ? "disabled" : ""}>${label}</button></div>`;
  }).join("");
}

function updateHeaderForFriend(friendId) {
  const profile = profileFor(friendId) || {};
  $("chatAvatar").src = profile.avatar_url || DEFAULT_AVATAR;
  $("chatName").textContent = profile.display_name || "Member";
  $("chatProfileBtn").href = `profile.html?id=${encodeURIComponent(friendId)}`;
  $("directInfoActions").hidden = false;
  $("groupInfoSection").hidden = true;
  $("groupMembersSection").hidden = true;
  $("infoPanelTitle").textContent = "Chat details";
}

function updateHeaderForGroup(group) {
  $("chatAvatar").src = group.avatar_url || DEFAULT_GROUP_AVATAR;
  $("chatName").textContent = group.name || "Group";
  $("directInfoActions").hidden = true;
  $("groupInfoSection").hidden = false;
  $("groupMembersSection").hidden = true;
  $("infoPanelTitle").textContent = "Group details";
}

function messageMediaHtml(message) {
  const url = message.media_url && isSafeUrl(message.media_url) ? message.media_url : "";
  if (!url) return "";
  const type = resolveAttachmentType({ mediaType: message.media_type, mediaUrl: url });
  if (type === "image") return `<img class="message-attachment-image" src="${escapeSelector(url)}" alt="Message attachment" loading="lazy">`;
  if (type === "video") return `<video class="message-attachment-video" controls preload="metadata" src="${escapeSelector(url)}"></video>`;
  if (type === "audio") return `<div class="message-voice"><div class="message-voice-mark"><span></span><span></span><span></span><span></span><span></span></div><audio controls preload="metadata" src="${escapeSelector(url)}"></audio></div>`;
  return `<a class="message-file" href="${escapeSelector(url)}" target="_blank" rel="noopener noreferrer" download><strong>${escapeHTML(getDisplayFileName(url))}</strong><small>${escapeHTML(message.media_type || "File")} · Open or download</small></a>`;
}

function renderMessages() {
  const target = $("chatMessages");
  if (!target) return;
  const term = state.messageSearchTerm.trim().toLowerCase();
  const messages = term ? state.messages.filter((m) => String(m.body || "").toLowerCase().includes(term)) : state.messages;
  if (!messages.length) {
    target.innerHTML = `<div class="chat-no-messages">${term ? "No messages match your search." : "No messages yet. Start the conversation."}</div>`;
    return;
  }
  target.innerHTML = messages.map((message) => {
    const self = message.sender_id === state.user.id;
    const profile = profileFor(message.sender_id) || {};
    const body = message.body ? escapeHTML(message.body).replace(/\n/g, "<br>") : "";
    return `<article class="chat-message ${self ? "self" : "received"}" data-message-id="${message.id}">
      ${!self && state.activeGroupId ? `<div class="chat-message-author">${escapeHTML(profile.display_name || "Member")}</div>` : ""}
      ${body ? `<div class="chat-message-body">${body}</div>` : ""}
      ${messageMediaHtml(message)}
      <div class="chat-message-meta"><span>${timeAgo(message.created_at)}</span>${message.is_edited ? "<span>edited</span>" : ""}</div>
    </article>`;
  }).join("");
  target.scrollTop = target.scrollHeight;
}

function renderInfoMedia() {
  const grid = $("infoMediaGrid");
  if (!grid) return;
  const items = state.messages.filter((m) => {
    const type = resolveAttachmentType({ mediaType: m.media_type, mediaUrl: m.media_url });
    return isSafeUrl(m.media_url || "") && (type === "image" || type === "video");
  }).slice(-18).reverse();
  grid.innerHTML = items.length ? items.map((m) => {
    const type = resolveAttachmentType({ mediaType: m.media_type, mediaUrl: m.media_url });
    return type === "video"
      ? `<a href="${escapeSelector(m.media_url)}" target="_blank" rel="noopener noreferrer"><video src="${escapeSelector(m.media_url)}" muted preload="metadata"></video></a>`
      : `<a href="${escapeSelector(m.media_url)}" target="_blank" rel="noopener noreferrer"><img src="${escapeSelector(m.media_url)}" alt="Shared media" loading="lazy"></a>`;
  }).join("") : `<div class="callout">No media shared yet.</div>`;
}

async function loadGroupMembers(threadId) {
  const result = await supabase.from("chat_members").select("id,user_id,role,tags,is_muted,is_pinned,last_read_at").eq("thread_id", threadId);
  if (result.error) throw result.error;
  const members = result.data || [];
  await loadProfiles(members.map((row) => row.user_id));
  state.groupMembers.set(threadId, members);
  renderGroupMembers();
}

function renderGroupMembers() {
  const section = $("groupMembersSection");
  const target = $("infoGroupMembers");
  if (!section || !target || !state.activeGroupId) return;
  const members = state.groupMembers.get(state.activeGroupId) || [];
  section.hidden = false;
  $("groupMemberCount").textContent = String(members.length);
  const owner = isOwnerOfActiveGroup();
  target.innerHTML = members.map((member) => {
    const profile = profileFor(member.user_id) || {};
    const tags = Array.isArray(member.tags) ? member.tags : [];
    return `<div class="group-member-row">
      <img class="chat-member-avatar" src="${escapeSelector(profile.avatar_url || DEFAULT_AVATAR)}" alt="">
      <div class="group-member-copy"><strong>${escapeHTML(profile.display_name || "Member")}${member.role === "owner" ? " · Owner" : ""}</strong><div class="member-tag-list">${tags.map((tag) => `<span class="member-tag">${escapeHTML(tag)}</span>`).join("") || "<span class=\"member-tag muted\">No tag</span>"}</div></div>
      ${owner ? `<button class="btn ghost sm" data-edit-member-tags="${member.id}" type="button">Edit tag</button>` : ""}
    </div>`;
  }).join("");
}

function fillGroupEditor(group) {
  $("groupAvatarPreview").src = group.avatar_url || DEFAULT_GROUP_AVATAR;
  $("groupNameInput").value = group.name || "";
  $("groupDescriptionInput").value = group.description || "";
  $("groupEditor").hidden = false;
}

function closeGroupEditor() {
  $("groupEditor").hidden = true;
}

async function saveGroupDetails() {
  const group = activeGroup();
  if (!group || !isOwnerOfActiveGroup()) return;
  const patch = {
    name: ($("groupNameInput").value || "").trim().slice(0, 80),
    description: ($("groupDescriptionInput").value || "").trim().slice(0, 300),
    updated_at: new Date().toISOString()
  };
  if (!patch.name) throw new Error("Group name is required.");
  const input = $("groupAvatarInput");
  if (input?.files?.[0]) patch.avatar_url = await uploadMedia(input.files[0], `group-avatars/${state.user.id}`);
  const result = await supabase.from("chat_threads").update(patch).eq("id", group.id).eq("created_by", state.user.id);
  if (result.error) throw result.error;
  Object.assign(group, patch);
  updateHeaderForGroup(group);
  renderGroups();
  fillGroupEditor(group);
  closeGroupEditor();
}

async function editMemberTags(memberId) {
  if (!isOwnerOfActiveGroup()) return;
  const members = state.groupMembers.get(state.activeGroupId) || [];
  const member = members.find((item) => item.id === memberId);
  if (!member) return;
  const current = Array.isArray(member.tags) ? member.tags.join(", ") : "";
  const raw = window.prompt("Member tags for this group, separated by commas:", current);
  if (raw === null) return;
  const tags = [...new Set(raw.split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 8))];
  const result = await supabase.from("chat_members").update({ tags }).eq("id", memberId).eq("thread_id", state.activeGroupId);
  if (result.error) throw result.error;
  member.tags = tags;
  renderGroupMembers();
}

async function createGroup() {
  const name = ($("newGroupName").value || "").trim();
  if (!name) throw new Error("Enter a group name.");
  const selected = [...document.querySelectorAll("#groupMemberPicker input[type=checkbox]:checked")].map((input) => input.value);
  if (!selected.length) throw new Error("Choose at least one friend.");
  const threadId = crypto.randomUUID();
  const now = new Date().toISOString();
  const thread = await supabase.from("chat_threads").insert({ id: threadId, name, is_group: true, created_by: state.user.id, created_at: now, updated_at: now, settings: {} }).select().single();
  if (thread.error) throw thread.error;
  const members = [...new Set([state.user.id, ...selected])].map((userId) => ({ id: crypto.randomUUID(), thread_id: threadId, user_id: userId, role: userId === state.user.id ? "owner" : "member", joined_at: now, tags: [] }));
  const memberResult = await supabase.from("chat_members").insert(members);
  if (memberResult.error) {
    await supabase.from("chat_threads").delete().eq("id", threadId);
    throw memberResult.error;
  }
  await closeModal("friendPickerModal");
  await loadAllChatData();
  renderGroups();
  await selectGroup(threadId);
}

async function sendFriendRequest(profileId) {
  const result = await supabase.from("friendships").insert({
    id: crypto.randomUUID(),
    requester_id: state.user.id,
    requester_name: getDisplayName(state.user),
    addressee_id: profileId,
    status: "pending",
    created_at: new Date().toISOString()
  });
  if (result.error) throw result.error;
  await loadAllChatData();
  renderRequests();
  renderPeopleResults();
  renderFriends();
}

async function handleRequests(event) {
  const button = event.target.closest("button[data-request]");
  if (!button) return;
  const row = state.friendships.find((item) => item.id === button.dataset.id);
  if (!row) return;
  const action = button.dataset.request;
  if (action === "accept") {
    const result = await supabase.from("friendships").update({ status: "accepted", updated_at: new Date().toISOString() }).eq("id", row.id);
    if (result.error) throw result.error;
  } else if (action === "decline" || action === "cancel") {
    const result = await supabase.from("friendships").delete().eq("id", row.id);
    if (result.error) throw result.error;
  }
  await loadAllChatData();
  renderRequests();
  renderBlocked();
  await renderFriends();
  renderPeopleResults();
}

async function selectFriend(friendId) {
  closeHeaderMenu();
  await unsubscribeRealtime();
  state.activeFriendId = friendId;
  state.activeGroupId = "";
  state.activeThreadId = threadForFriend(friendId);
  updateHeaderForFriend(friendId);
  await loadMessages(state.activeThreadId);
  await subscribeRealtime();
  setView("chat");
  setHeaderStatus("Live chat", true);
  updateComposerState();
  await renderFriends();
  renderGroups();
  renderInfoMedia();
}

async function selectGroup(groupId) {
  closeHeaderMenu();
  await unsubscribeRealtime();
  state.activeGroupId = groupId;
  state.activeFriendId = "";
  state.activeThreadId = groupId;
  const group = activeGroup();
  if (!group) return;
  updateHeaderForGroup(group);
  await loadMessages(groupId);
  await loadGroupMembers(groupId);
  await subscribeRealtime();
  setView("chat");
  setHeaderStatus("Live group chat", true);
  updateComposerState();
  await renderFriends();
  renderGroups();
  renderInfoMedia();
}

async function unsubscribeRealtime() {
  if (state.channel) {
    try { await supabase.removeChannel(state.channel); } catch (_) {}
    state.channel = null;
  }
  state.presence.clear();
  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
}

function scheduleReconnect() {
  if (!state.activeThreadId || state.reconnectTimer) return;
  setHeaderStatus("Reconnecting…", false);
  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null;
    try { await subscribeRealtime(); }
    catch (error) { console.warn("Chat reconnect failed", error); scheduleReconnect(); }
  }, 1500);
}

async function subscribeRealtime() {
  const threadId = state.activeThreadId;
  if (!threadId) return;
  const channel = supabase.channel(`timzee-chat-${threadId}-${crypto.randomUUID()}`);
  state.channel = channel;

  channel
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "direct_messages", filter: `thread_id=eq.${threadId}` }, async (payload) => {
      const incoming = payload.new;
      if (!incoming || state.messages.some((m) => m.id === incoming.id)) return;
      state.messages.push(incoming);
      await loadProfiles([incoming.sender_id]);
      renderMessages();
      renderInfoMedia();
      if (incoming.sender_id !== state.user.id && state.settings.notifications) showIncomingMessage(incoming);
    })
    .on("broadcast", { event: "typing" }, (payload) => {
      const senderId = payload.payload?.userId;
      if (!senderId || senderId === state.user.id) return;
      const name = payload.payload?.name || "Someone";
      const active = Boolean(payload.payload?.typing);
      showTyping(name, active);
    })
    .on("presence", { event: "sync" }, () => {
      const presence = channel.presenceState();
      state.presence.clear();
      Object.values(presence).flat().forEach((entry) => state.presence.set(entry.user_id, entry));
      refreshPresenceText();
    });

  const status = await new Promise((resolve) => {
    let finished = false;
    const timeout = setTimeout(() => { if (!finished) { finished = true; resolve("TIMED_OUT"); } }, 9000);
    channel.subscribe((statusValue) => {
      if (statusValue === "SUBSCRIBED" || statusValue === "CHANNEL_ERROR" || statusValue === "TIMED_OUT") {
        if (!finished) { finished = true; clearTimeout(timeout); resolve(statusValue); }
      }
    });
  });

  if (status !== "SUBSCRIBED") {
    scheduleReconnect();
    return;
  }
  await channel.track({ user_id: state.user.id, name: getDisplayName(state.user), at: Date.now() });
  setHeaderStatus(state.activeGroupId ? "Live group chat" : "Live chat", true);
}

function refreshPresenceText() {
  if (state.activeGroupId) {
    const onlineMembers = [...state.presence.keys()].filter((id) => id !== state.user.id).length;
    setHeaderStatus(onlineMembers ? `${onlineMembers} online · Live` : "Live group chat", true);
    return;
  }
  const online = state.presence.has(state.activeFriendId);
  setHeaderStatus(online ? "Online · Live" : "Live chat", true);
}

function showTyping(name, active) {
  const box = $("chatTyping");
  if (!box) return;
  box.hidden = !active;
  if ($("chatTypingName")) $("chatTypingName").textContent = name;
  clearTimeout(box._typingTimer);
  if (active) box._typingTimer = setTimeout(() => { box.hidden = true; }, 2500);
}

function showIncomingMessage(message) {
  if (state.settings.sounds) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) {
        const ctx = new Ctx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.frequency.value = 660;
        gain.gain.value = 0.035;
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.08);
      }
    } catch (_) {}
  }
  const sender = profileFor(message.sender_id)?.display_name || "New message";
  window.siteToast?.(`${sender}: ${message.body || "Attachment"}`, { type: "info", title: "New message" });
}

function broadcastTyping(typing) {
  if (!state.channel || !state.activeThreadId) return;
  void state.channel.send({ type: "broadcast", event: "typing", payload: { userId: state.user.id, name: getDisplayName(state.user), typing } });
}

function updateComposerState() {
  const textarea = $("chatBody");
  const media = $("chatMedia");
  const record = $("recordVoiceBtn");
  const send = $("chatForm")?.querySelector("button[type=submit]");
  const canSend = Boolean(state.user && state.activeThreadId);
  [textarea, media, record, send].forEach((el) => { if (el) el.disabled = !canSend; });
}

function clearMediaPreview() {
  if (state.previewUrl) {
    URL.revokeObjectURL(state.previewUrl);
    state.previewUrl = "";
  }
  const target = $("chatMediaPreview");
  if (target) target.innerHTML = "";
  state.mediaFile = null;
  state.mediaType = "";
}

function showMediaPreview(file) {
  const target = $("chatMediaPreview");
  if (!target) return;
  clearMediaPreview();
  state.mediaFile = file;
  state.mediaType = resolveAttachmentType({ mimeType: file.type, fileName: file.name });
  state.previewUrl = URL.createObjectURL(file);
  const type = state.mediaType;
  const body = type === "image"
    ? `<img src="${escapeSelector(state.previewUrl)}" alt="Attachment preview">`
    : type === "video"
      ? `<video controls src="${escapeSelector(state.previewUrl)}"></video>`
      : type === "audio"
        ? `<div class="voice-preview"><div class="voice-preview-bars" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i></div><audio controls src="${escapeSelector(state.previewUrl)}"></audio></div>`
        : `<div class="media-preview-file"><strong>${escapeHTML(file.name || "Attachment")}</strong><small>${escapeHTML(file.type || "File")} · ${escapeHTML(formatFileSize(file.size))}</small></div>`;
  target.innerHTML = `${body}<button class="btn ghost sm" type="button" id="removeChatMedia">Remove</button>`;
  $("removeChatMedia")?.addEventListener("click", clearMediaPreview);
}

function stopRecorderTracks() {
  state.recorderStream?.getTracks().forEach((track) => track.stop());
  state.recorderStream = null;
  if (state.audioContext) {
    try { state.audioContext.close(); } catch (_) {}
    state.audioContext = null;
  }
  state.analyser = null;
  if (state.analyserFrame) cancelAnimationFrame(state.analyserFrame);
  state.analyserFrame = 0;
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = String(total % 60).padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function buildWaveform() {
  const target = $("voiceWaveform");
  if (!target) return;
  target.innerHTML = Array.from({ length: 40 }, (_, i) => `<span data-wave="${i}"></span>`).join("");
}

function animateWaveform() {
  const bars = [...document.querySelectorAll("#voiceWaveform [data-wave]")];
  if (!bars.length) return;
  if (state.analyser) {
    const data = new Uint8Array(state.analyser.frequencyBinCount);
    state.analyser.getByteFrequencyData(data);
    bars.forEach((bar, index) => {
      const value = data[Math.floor(index / bars.length * data.length)] || 20;
      bar.style.height = `${Math.max(4, Math.min(46, Math.round(value / 255 * 48)))}px`;
    });
  } else {
    bars.forEach((bar, index) => {
      bar.style.height = `${8 + Math.abs(Math.sin((Date.now() / 180) + index)) * 28}px`;
    });
  }
  state.analyserFrame = requestAnimationFrame(animateWaveform);
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error("Voice recording is not supported in this browser.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  state.recorderStream = stream;
  state.recorderChunks = [];
  state.recorder = new MediaRecorder(stream);
  state.recorderStartedAt = Date.now();
  buildWaveform();
  $("voiceRecordingSheet").hidden = false;
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  state.audioContext = audioContext;
  const source = audioContext.createMediaStreamSource(stream);
  state.analyser = audioContext.createAnalyser();
  state.analyser.fftSize = 64;
  source.connect(state.analyser);
  state.recorder.ondataavailable = (event) => { if (event.data.size) state.recorderChunks.push(event.data); };
  state.recorder.onstop = () => {
    const mime = state.recorder?.mimeType || "audio/webm";
    const blob = new Blob(state.recorderChunks, { type: mime });
    const file = new File([blob], `voice-${Date.now()}.webm`, { type: mime });
    showMediaPreview(file);
    stopRecorderTracks();
  };
  state.recorder.start(120);
  $("recordVoiceBtn").classList.add("is-recording");
  $("recordVoiceBtn").setAttribute("aria-label", "Recording voice");
  state.recorderTimer = setInterval(() => { $("voiceRecordingTimer").textContent = formatDuration(Date.now() - state.recorderStartedAt); }, 200);
  animateWaveform();
}

function stopRecording(save = true) {
  if (!state.recorder) return;
  clearInterval(state.recorderTimer);
  state.recorderTimer = null;
  if (!save) {
    state.recorder.onstop = () => stopRecorderTracks();
  }
  try { state.recorder.stop(); } catch (_) {}
  $("voiceRecordingSheet").hidden = true;
  $("recordVoiceBtn").classList.remove("is-recording");
  $("recordVoiceBtn").setAttribute("aria-label", "Record voice");
  state.recorder = null;
  $("voiceRecordingTimer").textContent = "0:00";
}

async function sendMessage() {
  const body = ($("chatBody").value || "").trim();
  if (!state.activeThreadId || (!body && !state.mediaFile)) return;
  const sendButton = $("chatForm")?.querySelector("button[type=submit]");
  if (sendButton) sendButton.disabled = true;
  try {
    let mediaUrl = "";
    if (state.mediaFile) mediaUrl = await uploadMedia(state.mediaFile, "direct-messages");
    const payload = {
      id: crypto.randomUUID(),
      thread_id: state.activeThreadId,
      sender_id: state.user.id,
      recipient_id: state.activeFriendId || null,
      body,
      media_url: mediaUrl,
      media_type: state.mediaType || "",
      created_at: new Date().toISOString()
    };
    const result = await supabase.from("direct_messages").insert(payload).select().single();
    if (result.error) throw result.error;
    const saved = result.data || payload;
    if (!state.messages.some((m) => m.id === saved.id)) state.messages.push(saved);
    renderMessages();
    renderInfoMedia();
    $("chatBody").value = "";
    autoGrowComposer();
    clearMediaPreview();
    broadcastTyping(false);
  } finally {
    if (sendButton) sendButton.disabled = false;
  }
}

function autoGrowComposer() {
  const textarea = $("chatBody");
  if (!textarea) return;
  textarea.style.height = "auto";
  textarea.style.height = `${Math.min(textarea.scrollHeight, 140)}px`;
}

function openModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.hidden = false;
  document.body.classList.add("modal-open");
}

async function closeModal(id) {
  const modal = $(id);
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("modal-open");
}

function renderGroupPicker() {
  const target = $("groupMemberPicker");
  if (!target) return;
  target.innerHTML = state.friends.map((id) => {
    const profile = profileFor(id) || {};
    return `<label class="chat-picker-row"><input type="checkbox" value="${id}"><img src="${escapeSelector(profile.avatar_url || DEFAULT_AVATAR)}" alt=""><span><strong>${escapeHTML(profile.display_name || "Member")}</strong><small>${escapeHTML(profile.username || "")}</small></span></label>`;
  }).join("");
  $("groupPickerEmpty").hidden = state.friends.length !== 0;
}

function setupTabs() {
  const tabs = document.querySelectorAll(".chat-tab");
  const panels = document.querySelectorAll(".chat-tab-panel");
  function show(name) {
    tabs.forEach((tab) => {
      const active = tab.dataset.tab === name;
      tab.classList.toggle("active", active);
      tab.setAttribute("aria-selected", String(active));
    });
    panels.forEach((panel) => { panel.hidden = panel.dataset.panel !== name; });
    $("peopleSearchPanel").hidden = true;
  }
  tabs.forEach((tab) => tab.addEventListener("click", () => show(tab.dataset.tab)));
  $("peopleSearchToggle")?.addEventListener("click", () => {
    const panel = $("peopleSearchPanel");
    panel.hidden = !panel.hidden;
    panels.forEach((p) => { p.hidden = !panel.hidden || p.dataset.panel !== "all"; });
    tabs.forEach((tab) => { tab.classList.remove("active"); tab.setAttribute("aria-selected", "false"); });
    if (!panel.hidden) { $("peopleSearch")?.focus(); renderPeopleResults(); }
    else show("all");
  });
}

function setupEvents() {
  $("chatSearch")?.addEventListener("input", async (event) => {
    state.searchTerm = event.target.value || "";
    await renderFriends();
    renderGroups();
  });
  $("peopleSearch")?.addEventListener("input", (event) => { state.peopleTerm = event.target.value || ""; renderPeopleResults(); });
  $("friendList")?.addEventListener("click", async (event) => { const row = event.target.closest("[data-friend-id]"); if (row) await selectFriend(row.dataset.friendId); });
  $("groupList")?.addEventListener("click", async (event) => { const row = event.target.closest("[data-group-id]"); if (row) await selectGroup(row.dataset.groupId); });
  $("friendRequests")?.addEventListener("click", handleRequests);
  $("friendRequestsSent")?.addEventListener("click", handleRequests);
  $("blockedList")?.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-unblock]");
    if (!button) return;
    const row = state.friendships.find((item) => item.status === "blocked" && item.blocked_by === state.user.id && (item.requester_id === button.dataset.unblock || item.addressee_id === button.dataset.unblock));
    if (row) await supabase.from("friendships").delete().eq("id", row.id);
    await loadAllChatData();
    renderBlocked();
    await renderFriends();
  });
  $("peopleResults")?.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-people-action]");
    if (!button || button.disabled) return;
    if (button.dataset.peopleAction === "request") await sendFriendRequest(button.dataset.id);
    else await selectFriend(button.dataset.id);
  });
  $("chatBody")?.addEventListener("input", () => { autoGrowComposer(); broadcastTyping(true); clearTimeout($("chatBody")._typingTimer); $("chatBody")._typingTimer = setTimeout(() => broadcastTyping(false), 900); });
  $("chatBody")?.addEventListener("keydown", async (event) => {
    if (event.key === "Enter" && !event.shiftKey && state.settings.enterToSend) {
      event.preventDefault();
      await sendMessage();
    }
  });
  $("chatForm")?.addEventListener("submit", async (event) => { event.preventDefault(); try { await sendMessage(); } catch (error) { reportAppError(error, "Chat message send failed"); $("chatStatus").textContent = error.message || "Message failed."; $("chatStatus").hidden = false; } });
  $("chatMedia")?.addEventListener("change", (event) => { const file = event.target.files?.[0]; if (file) showMediaPreview(file); event.target.value = ""; });
  $("recordVoiceBtn")?.addEventListener("click", async () => {
    try {
      if (state.recorder) stopRecording(true);
      else await startRecording();
    } catch (error) { reportAppError(error, "Voice recording failed"); window.siteToast?.(error.message || "Voice recording is unavailable.", { type: "error", title: "Voice recording" }); }
  });
  $("voiceCancelBtn")?.addEventListener("click", () => { stopRecording(false); clearMediaPreview(); });
  $("voiceStopBtn")?.addEventListener("click", () => stopRecording(true));
  $("chatBackBtn")?.addEventListener("click", async () => { setView("list"); await unsubscribeRealtime(); });
  $("chatInfoToggle")?.addEventListener("click", () => { $("chatInfoPanel").classList.add("open"); $("chatInfoBackdrop").hidden = false; });
  $("chatInfoClose")?.addEventListener("click", () => { $("chatInfoPanel").classList.remove("open"); $("chatInfoBackdrop").hidden = true; });
  $("chatInfoBackdrop")?.addEventListener("click", () => { $("chatInfoPanel").classList.remove("open"); $("chatInfoBackdrop").hidden = true; });
  $("chatMenuToggle")?.addEventListener("click", (event) => { event.stopPropagation(); const menu = $("chatHeaderMenu"); menu.hidden ? openHeaderMenu() : closeHeaderMenu(); });
  document.addEventListener("click", (event) => { if (!event.target.closest(".chat-header-actions")) closeHeaderMenu(); });
  $("chatHeaderMenu")?.addEventListener("click", async (event) => {
    const action = event.target.closest("button[data-chat-menu]")?.dataset.chatMenu;
    if (!action) return;
    closeHeaderMenu();
    if (action === "search") { state.messageSearchTerm = window.prompt("Search in this chat:", state.messageSearchTerm) || ""; renderMessages(); }
    if (action === "settings") { defaultSettingsUI(); openModal("chatSettingsModal"); }
    if (action === "mute" || action === "pin") await toggleChatMemberFlag(action);
    if (action === "report") window.location.href = `contact.html?subject=${encodeURIComponent("Chat report")}`;
  });
  document.querySelectorAll("[data-close-modal]").forEach((button) => button.addEventListener("click", () => closeModal(button.dataset.closeModal)));
  document.querySelectorAll("[data-chat-setting]").forEach((input) => input.addEventListener("change", () => { state.settings[input.dataset.chatSetting] = input.checked; saveSettings(); }));
  $("newGroupBtn")?.addEventListener("click", () => { renderGroupPicker(); openModal("friendPickerModal"); });
  $("friendPickerClose")?.addEventListener("click", () => closeModal("friendPickerModal"));
  $("friendPickerCancel")?.addEventListener("click", () => closeModal("friendPickerModal"));
  $("friendPickerCreate")?.addEventListener("click", async () => { try { await createGroup(); } catch (error) { window.siteToast?.(error.message || "Group creation failed.", { type: "error", title: "Create group" }); } });
  $("groupMemberSearch")?.addEventListener("input", (event) => {
    const query = event.target.value.trim().toLowerCase();
    document.querySelectorAll("#groupMemberPicker .chat-picker-row").forEach((row) => { row.hidden = !(`${row.innerText || ""}`.toLowerCase().includes(query)); });
  });
  $("editGroupBtn")?.addEventListener("click", () => { const group = activeGroup(); if (group) fillGroupEditor(group); });
  $("cancelGroupBtn")?.addEventListener("click", closeGroupEditor);
  $("saveGroupBtn")?.addEventListener("click", async () => { try { await saveGroupDetails(); } catch (error) { window.siteToast?.(error.message || "Group update failed.", { type: "error", title: "Group settings" }); } });
  $("infoGroupMembers")?.addEventListener("click", async (event) => { const button = event.target.closest("[data-edit-member-tags]"); if (!button) return; try { await editMemberTags(button.dataset.editMemberTags); } catch (error) { window.siteToast?.(error.message || "Could not update the tag.", { type: "error", title: "Member tag" }); } });
  window.addEventListener("online", () => { if (state.activeThreadId) scheduleReconnect(); });
  window.addEventListener("offline", () => { if (state.activeThreadId) setHeaderStatus("Offline", false); });
}

async function toggleChatMemberFlag(kind) {
  const threadId = state.activeThreadId;
  if (!threadId) return;
  const existing = await supabase.from("chat_members").select("is_muted,is_pinned").eq("thread_id", threadId).eq("user_id", state.user.id).maybeSingle();
  if (existing.error) throw existing.error;
  const current = existing.data || {};
  const key = kind === "mute" ? "is_muted" : "is_pinned";
  const next = !Boolean(current[key]);
  const result = await supabase.from("chat_members").update({ [key]: next }).eq("thread_id", threadId).eq("user_id", state.user.id);
  if (result.error) throw result.error;
  const group = activeGroup();
  if (group && kind === "mute") group.is_muted = next;
  if (group && kind === "pin") group.is_pinned = next;
  await renderFriends();
  renderGroups();
  window.siteToast?.(`${kind === "mute" ? "Notifications" : "Chat"} ${next ? "updated" : "unfixed"}.`, { type: "info", title: "Chat" });
}

async function boot() {
  setupTabs();
  setupEvents();
  state.settings = readSettings();
  defaultSettingsUI();
  state.user = await getCurrentUserWithRole();
  if (!state.user) {
    $("chatEmptyState").innerHTML = `<div class="chat-empty-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H11l-4.5 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z" fill="none" stroke="currentColor" stroke-width="1.6"/></svg></div><h2>Sign in to chat</h2><p>Private conversations are available after you log in.</p><a class="btn" href="login.html?next=chat.html">Log in</a>`;
    setView("list");
    return;
  }
  await loadAllChatData();
  await renderFriends();
  renderGroups();
  renderRequests();
  renderBlocked();
  renderPeopleResults();
  updateComposerState();
  const params = new URLSearchParams(window.location.search);
  const friendId = params.get("user");
  const groupId = params.get("group");
  if (friendId && state.friends.includes(friendId)) await selectFriend(friendId);
  else if (groupId && state.groups.some((group) => group.id === groupId)) await selectGroup(groupId);
}

boot().catch((error) => {
  reportAppError(error, "Chat initialization failed");
  const target = $("chatMessages");
  if (target) target.innerHTML = `<div class="chat-no-messages">Unable to load chats right now. ${escapeHTML(error.message || "Please try again.")}</div>`;
});
