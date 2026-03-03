import { supabase, getCurrentUser, getCurrentUserWithRole, getDisplayName, signOut } from "./supabase.js";
import { fetchSettings } from "./settings.js";
import { fetchThemeById, applyThemeVariables } from "./themes.js";
import { uploadMedia } from "./media.js";
import { timeAgo, escapeHTML, isSafeUrl, extractErrorMessage, reportAppError } from "./utils.js";
import { setupReveal } from "./reveal.js";
import "./nav.js";

const state = {
  user: null,
  friendships: [],
  friends: [],
  friendProfiles: {},
  profileCache: {},
  requests: [],
  sentRequests: [],
  requestProfiles: {},
  blocked: [],
  blockedProfiles: {},
  blockedBy: [],
  activeFriendId: null,
  activeGroupId: null,
  groups: [],
  groupMembers: {},
  messages: [],
  channel: null,
  lastMessages: {},
  searchTerm: "",
  peopleSearchTerm: "",
  peopleResults: []
};

function renderAuthActions() {
  const actions = document.getElementById("authActions");
  if (!actions) return;
  actions.innerHTML = "";
  if (state.user) {
    const label = document.createElement("span");
    label.className = "auth-meta";
    label.textContent = getDisplayName(state.user);
    const profile = document.createElement("a");
    profile.className = "btn ghost";
    profile.href = `profile.html?id=${encodeURIComponent(state.user.id)}`;
    profile.textContent = "Profile";
    let notifications = document.getElementById("notificationLink");
    if (!notifications) {
      notifications = document.createElement("a");
      notifications.className = "btn ghost";
      notifications.href = "profile.html?tab=notifications";
      notifications.id = "notificationLink";
      notifications.innerHTML =
        'Notifications <span class="notif-count" id="notificationCount" style="display:none;">0</span>';
    }
    const logout = document.createElement("button");
    logout.className = "btn ghost";
    logout.textContent = "Log Out";
    logout.addEventListener("click", async () => {
      await signOut();
      window.location.reload();
    });
    actions.appendChild(label);
    actions.appendChild(profile);
    actions.appendChild(notifications);
    actions.appendChild(logout);
  } else {
    const login = document.createElement("a");
    login.className = "btn ghost";
    login.href = "login.html?next=chat.html";
    login.textContent = "Log In";
    actions.appendChild(login);
  }
}

function setChatView(view) {
  const layout = document.getElementById("chatLayout");
  if (!layout) return;
  layout.dataset.view = view;
}

function getThreadId(friendId) {
  return [state.user.id, friendId].sort().join("_");
}

function getActiveThreadId() {
  if (state.activeGroupId) return state.activeGroupId;
  if (state.activeFriendId) return getThreadId(state.activeFriendId);
  return null;
}

async function loadFriendships() {
  const result = await supabase
    .from("friendships")
    .select("*")
    .or(`requester_id.eq.${state.user.id},addressee_id.eq.${state.user.id}`);
  const friendships = result.data || [];
  state.friendships = friendships;
  state.friends = friendships
    .filter((row) => row.status === "accepted")
    .map((row) => (row.requester_id === state.user.id ? row.addressee_id : row.requester_id));
  state.requests = friendships.filter(
    (row) => row.status === "pending" && row.addressee_id === state.user.id
  );
  state.sentRequests = friendships.filter(
    (row) => row.status === "pending" && row.requester_id === state.user.id
  );
  state.blocked = friendships
    .filter((row) => row.status === "blocked" && row.blocked_by === state.user.id)
    .map((row) => (row.requester_id === state.user.id ? row.addressee_id : row.requester_id));
  state.blockedBy = friendships
    .filter((row) => row.status === "blocked" && row.blocked_by !== state.user.id)
    .map((row) => (row.requester_id === state.user.id ? row.addressee_id : row.requester_id));

  const profileIds = new Set([
    ...state.friends,
    ...state.requests.map((row) => row.requester_id),
    ...state.sentRequests.map((row) => row.addressee_id),
    ...state.blocked
  ]);
  if (!profileIds.size) {
    state.friendProfiles = {};
    state.requestProfiles = {};
    state.blockedProfiles = {};
    return;
  }
  const profiles = await supabase.from("profiles").select("*").in("id", Array.from(profileIds));
  const map = {};
  (profiles.data || []).forEach((profile) => {
    map[profile.id] = profile;
    state.profileCache[profile.id] = profile;
  });
  state.friendProfiles = map;
  state.requestProfiles = map;
  state.blockedProfiles = map;
}

async function loadThreadPreviews() {
  state.lastMessages = {};
  const directThreadIds = state.friends.map((friendId) => getThreadId(friendId));
  const groupThreadIds = state.groups.map((group) => group.id);
  const threadIds = [...directThreadIds, ...groupThreadIds];
  if (!threadIds.length) return;
  const result = await supabase
    .from("direct_messages")
    .select("thread_id, body, media_type, created_at, sender_id")
    .in("thread_id", threadIds)
    .order("created_at", { ascending: false });
  (result.data || []).forEach((message) => {
    if (!state.lastMessages[message.thread_id]) {
      state.lastMessages[message.thread_id] = message;
    }
  });
}

async function loadGroups() {
  try {
    const result = await supabase
      .from("chat_members")
      .select("thread_id, chat_threads(id, name, is_group, created_by, created_at)")
      .eq("user_id", state.user?.id);
    const rows = result.data || [];
    const groups = rows
      .map((row) => row.chat_threads)
      .filter((thread) => thread && thread.is_group);
    state.groups = groups;
  } catch (err) {
    console.warn("Failed to load groups", err);
    state.groups = [];
  }
}

async function loadGroupMembers(threadId) {
  try {
    const result = await supabase
      .from("chat_members")
      .select("user_id")
      .eq("thread_id", threadId);
    const ids = (result.data || []).map((row) => row.user_id).filter(Boolean);
    state.groupMembers[threadId] = ids;
    if (ids.length) {
      const profiles = await supabase.from("profiles").select("*").in("id", ids);
      (profiles.data || []).forEach((profile) => {
        state.profileCache[profile.id] = profile;
      });
    }
  } catch (err) {
    console.warn("loadGroupMembers failed:", err);
    state.groupMembers[threadId] = [];
  }
}

function getFriendshipRow(friendId) {
  return state.friendships.find(
    (row) =>
      (row.requester_id === state.user.id && row.addressee_id === friendId) ||
      (row.addressee_id === state.user.id && row.requester_id === friendId)
  );
}

function renderFriendList() {
  const list = document.getElementById("friendList");
  if (!list) return;
  if (!state.friends.length) {
    list.innerHTML = "<div class=\"callout\">No friends yet — add someone new.</div>";
    return;
  }
  const query = state.searchTerm.toLowerCase();
  const filtered = state.friends.filter((friendId) => {
    const profile = state.friendProfiles[friendId];
    const name = (profile?.display_name || "Member").toLowerCase();
    const username = (profile?.username || "").toLowerCase();
    const email = (profile?.email || "").toLowerCase();
    return !query || name.includes(query) || username.includes(query) || email.includes(query);
  });
  if (!filtered.length) {
    list.innerHTML = "<div class=\"callout\">No matches.</div>";
    return;
  }

  list.innerHTML = filtered
    .map((friendId) => {
      const profile = state.friendProfiles[friendId];
      const isActive = friendId === state.activeFriendId;
      const threadId = getThreadId(friendId);
      const last = state.lastMessages[threadId];
      const prefix = last && last.sender_id === state.user.id ? "You: " : "";
      const preview = last
        ? last.body
          ? last.body
          : last.media_type
            ? `Sent ${last.media_type}`
            : "Media"
        : "Tap to chat";
      const time = last ? timeAgo(last.created_at) : "";
      return `
        <div class="chat-item ${isActive ? "active" : ""}" data-id="${friendId}">
          <img class="chat-item-avatar" src="${profile?.avatar_url || "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80"}" alt="friend avatar">
          <div class="chat-item-body">
            <div class="chat-item-top">
              <span>${escapeHTML(profile?.display_name || "Member")}</span>
              <span class="chat-item-time">${time}</span>
            </div>
            <div class="chat-item-preview">${escapeHTML(`${prefix}${preview}`)}</div>
          </div>
        </div>
      `;
    })
    .join("");

  list.querySelectorAll(".chat-item").forEach((item) => {
    item.addEventListener("click", () => {
      selectFriend(item.dataset.id);
    });
  });
}

function renderGroupList() {
  const list = document.getElementById("groupList");
  if (!list) return;
  if (!state.groups.length) {
    list.innerHTML = "<div class=\"callout\">No groups yet — start one.</div>";
    return;
  }
  const query = state.searchTerm.toLowerCase();
  const filtered = state.groups.filter((group) => {
    const name = (group.name || "Group").toLowerCase();
    return !query || name.includes(query);
  });
  if (!filtered.length) {
    list.innerHTML = "<div class=\"callout\">No matches.</div>";
    return;
  }
  list.innerHTML = filtered
    .map((group) => {
      const isActive = group.id === state.activeGroupId;
      const last = state.lastMessages[group.id];
      const prefix = last && last.sender_id === state.user.id ? "You: " : "";
      const preview = last
        ? last.body
          ? last.body
          : last.media_type
            ? `Sent ${last.media_type}`
            : "Media"
        : "Group chat";
      const time = last ? timeAgo(last.created_at) : "";
      return `
        <div class="chat-item ${isActive ? "active" : ""}" data-id="${group.id}">
          <div class="chat-item-avatar group-avatar">#</div>
          <div class="chat-item-body">
            <div class="chat-item-top">
              <span>${escapeHTML(group.name || "Group")}</span>
              <span class="chat-item-time">${time}</span>
            </div>
            <div class="chat-item-preview">${escapeHTML(`${prefix}${preview}`)}</div>
          </div>
        </div>
      `;
    })
    .join("");

  list.querySelectorAll(".chat-item").forEach((item) => {
    item.addEventListener("click", () => {
      selectGroup(item.dataset.id);
    });
  });
}

function renderRequests() {
  const list = document.getElementById("friendRequests");
  const sentList = document.getElementById("friendRequestsSent");
  if (!list) return;
  if (!state.requests.length) {
    list.innerHTML = "<div class=\"callout\">No incoming requests yet.</div>";
  } else {
    list.innerHTML = state.requests
      .map((req) => {
        const profile = state.requestProfiles[req.requester_id];
        return `
          <div class="chat-item" data-id="${req.id}">
            <img class="chat-item-avatar" src="${profile?.avatar_url || "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80"}" alt="request avatar">
            <div class="chat-item-body">
              <div class="chat-item-top">
                <span>${escapeHTML(profile?.display_name || req.requester_name || "New friend")}</span>
                <span class="chat-item-time">${timeAgo(req.created_at)}</span>
              </div>
              <div class="chat-item-preview">Friend request</div>
              <div class="inline-actions">
                <button class="btn" data-action="accept" data-id="${req.id}">Accept</button>
                <button class="btn ghost" data-action="decline" data-id="${req.id}">Decline</button>
              </div>
            </div>
          </div>
        `;
      })
      .join("");
  }

  list.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const request = state.requests.find((item) => item.id === btn.dataset.id);
      if (!request) return;
      if (btn.dataset.action === "accept") {
        await supabase
          .from("friendships")
          .update({ status: "accepted", updated_at: new Date().toISOString() })
          .eq("id", request.id);
      }
      if (btn.dataset.action === "decline") {
        await supabase.from("friendships").delete().eq("id", request.id);
      }
      await loadFriendships();
      await loadThreadPreviews();
      renderRequests();
      renderFriendList();
      renderBlockedList();
    });
  });

  if (sentList) {
    if (!state.sentRequests.length) {
      sentList.innerHTML = "<div class=\"callout\">No outgoing requests yet.</div>";
    } else {
      sentList.innerHTML = state.sentRequests
        .map((req) => {
          const profile = state.requestProfiles[req.addressee_id];
          return `
            <div class="chat-item" data-id="${req.id}">
              <img class="chat-item-avatar" src="${profile?.avatar_url || "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80"}" alt="request avatar">
              <div class="chat-item-body">
                <div class="chat-item-top">
                  <span>${escapeHTML(profile?.display_name || "Member")}</span>
                  <span class="chat-item-time">${timeAgo(req.created_at)}</span>
                </div>
                <div class="chat-item-preview">Request sent</div>
                <div class="inline-actions">
                  <button class="btn ghost" data-action="cancel" data-id="${req.id}">Cancel</button>
                </div>
              </div>
            </div>
          `;
        })
        .join("");
    }

    sentList.querySelectorAll("button[data-action='cancel']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const request = state.sentRequests.find((item) => item.id === btn.dataset.id);
        if (!request) return;
        await supabase.from("friendships").delete().eq("id", request.id);
        await loadFriendships();
        await loadThreadPreviews();
        renderRequests();
        renderFriendList();
        renderBlockedList();
      });
    });
  }
}

function renderBlockedList() {
  const list = document.getElementById("blockedList");
  if (!list) return;
  if (!state.blocked.length) {
    list.innerHTML = "<div class=\"callout\">No blocked users.</div>";
    return;
  }
  list.innerHTML = state.blocked
    .map((userId) => {
      const profile = state.blockedProfiles[userId];
      return `
        <div class="chat-item" data-id="${userId}">
          <img class="chat-item-avatar" src="${profile?.avatar_url || "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80"}" alt="blocked avatar">
          <div class="chat-item-body">
            <div class="chat-item-top">
              <span>${escapeHTML(profile?.display_name || "Member")}</span>
              <span class="chat-item-time">Blocked</span>
            </div>
            <div class="chat-item-preview">You will not receive messages</div>
            <div class="inline-actions">
              <button class="btn ghost" data-action="unblock" data-id="${userId}">Unblock</button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  list.querySelectorAll("button[data-action='unblock']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Unblock this user?")) return;
      const userId = btn.dataset.id;
      const row = state.friendships.find(
        (friendship) =>
          friendship.status === "blocked" &&
          friendship.blocked_by === state.user.id &&
          (friendship.requester_id === userId || friendship.addressee_id === userId)
      );
      if (!row) return;
      await supabase.from("friendships").delete().eq("id", row.id);
      await loadFriendships();
      await loadThreadPreviews();
      renderBlockedList();
      renderFriendList();
    });
  });
}

async function sendFriendRequest(userId) {
  if (!userId) return;
  const existing = getFriendshipRow(userId);
  if (existing) return;
  await supabase.from("friendships").insert({
    id: crypto.randomUUID(),
    requester_id: state.user.id,
    requester_name: getDisplayName(state.user),
    addressee_id: userId,
    status: "pending",
    created_at: new Date().toISOString()
  });
  await loadFriendships();
  await loadThreadPreviews();
  renderFriendList();
  renderRequests();
  renderBlockedList();
}

function renderPeopleResults() {
  const list = document.getElementById("peopleResults");
  if (!list) return;
  if (!state.peopleSearchTerm) {
    list.innerHTML = "<div class=\"callout\">Search for people to connect.</div>";
    return;
  }
  if (!state.peopleResults.length) {
    list.innerHTML = "<div class=\"callout\">No users found — try a different name.</div>";
    return;
  }
  list.innerHTML = state.peopleResults
    .map((profile) => {
      const friendship = getFriendshipRow(profile.id);
      const isFriend = friendship?.status === "accepted";
      const isPending = friendship?.status === "pending";
      const isBlocked = friendship?.status === "blocked";
      const label = isFriend
        ? "Message"
        : isBlocked
          ? "Blocked"
          : isPending
            ? "Requested"
            : "Add Friend";
      const action = isFriend ? "message" : "connect";
      return `
        <div class="chat-item" data-id="${profile.id}">
          <img class="chat-item-avatar" src="${profile.avatar_url || "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80"}" alt="avatar">
          <div class="chat-item-body">
            <div class="chat-item-top">
              <span>${escapeHTML(profile.display_name || profile.username || "Member")}</span>
            </div>
            <div class="chat-item-preview">${escapeHTML(
              profile.show_email ? profile.email || profile.username || "" : profile.username || ""
            )}</div>
            <div class="inline-actions">
              <button class="btn ghost" data-action="${action}" data-id="${profile.id}" ${
                isPending || isBlocked ? "disabled" : ""
              }>${label}</button>
            </div>
          </div>
        </div>
      `;
    })
    .join("");

  list.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const userId = btn.dataset.id;
      if (btn.dataset.action === "message") {
        if (state.friends.includes(userId)) {
          await selectFriend(userId);
        }
        return;
      }
      if (btn.dataset.action === "connect") {
        await sendFriendRequest(userId);
        await searchPeople(state.peopleSearchTerm);
      }
    });
  });
}

async function searchPeople(term) {
  const query = term.trim();
  state.peopleSearchTerm = query;
  if (!query) {
    state.peopleResults = [];
    renderPeopleResults();
    return;
  }
  const result = await supabase
    .from("profiles")
    .select("id, display_name, username, email, avatar_url, headline, show_email")
    .or(`display_name.ilike.%${query}%,username.ilike.%${query}%,email.ilike.%${query}%`)
    .limit(20);
  const rows = (result.data || []).filter((profile) => profile.id !== state.user.id);
  state.peopleResults = rows;
  rows.forEach((profile) => {
    state.profileCache[profile.id] = profile;
  });
  renderPeopleResults();
}

async function loadMessages(threadId) {
  const result = await supabase
    .from("direct_messages")
    .select("*")
    .eq("thread_id", threadId)
    .order("created_at", { ascending: true });
  state.messages = result.data || [];
  renderMessages();
}

function renderMessages() {
  const list = document.getElementById("chatMessages");
  if (!list) return;
  if (!state.activeFriendId && !state.activeGroupId) {
    list.innerHTML = "<div class=\"callout\">Select a chat to start messaging.</div>";
    return;
  }
  if (!state.messages.length) {
    list.innerHTML = "<div class=\"callout\">No messages yet — start the conversation.</div>";
    return;
  }
  list.innerHTML = state.messages
    .map((message) => {
      const isSelf = message.sender_id === state.user.id;
      const bodyHtml = message.body ? escapeHTML(message.body).replace(/\n/g, "<br>") : "";
      let mediaHtml = "";
      if (message.media_url) {
        if (message.media_type === "video") {
          mediaHtml = `<video class="message-media" controls src="${message.media_url}"></video>`;
        } else if (message.media_type === "audio") {
          mediaHtml = `<audio controls src="${message.media_url}"></audio>`;
        } else {
          mediaHtml = `<img class="message-media" src="${message.media_url}" alt="message media">`;
        }
      }
      const senderName = isSelf
        ? "You"
        : escapeHTML(state.profileCache[message.sender_id]?.display_name || "Member");
      return `
        <div class="chat-bubble ${isSelf ? "self" : ""}">
          ${bodyHtml ? `<div class="message-body">${bodyHtml}</div>` : ""}
          ${mediaHtml}
          <div class="chat-meta">
            <span>${senderName}</span>
            <span>${timeAgo(message.created_at)}</span>
          </div>
        </div>
      `;
    })
    .join("");
  list.scrollTop = list.scrollHeight;
}

function updateChatFormState() {
  const form = document.getElementById("chatForm");
  const status = document.getElementById("chatStatus");
  const body = document.getElementById("chatBody");
  const media = document.getElementById("chatMedia");
  const recordBtn = document.getElementById("recordVoiceBtn");
  const profileBtn = document.getElementById("chatProfileBtn");
  const removeBtn = document.getElementById("chatRemoveBtn");
  const blockBtn = document.getElementById("chatBlockBtn");
  const statusText = document.getElementById("chatStatusText");
  if (!form) return;

  const activeId = state.activeFriendId;
  const activeGroup = state.activeGroupId;
  let disabledReason = "";

  if (!activeId && !activeGroup) {
    disabledReason = "Select a chat to start messaging.";
    if (statusText) statusText.textContent = "Ready when you are.";
  } else if (activeGroup) {
    if (statusText) statusText.textContent = "Group chat";
  } else {
    const profile = state.friendProfiles[activeId];
    const friendship = getFriendshipRow(activeId);
    if (friendship?.status === "blocked") {
      disabledReason = "This chat is blocked.";
      if (statusText) statusText.textContent = "Chat blocked";
    } else if (profile && profile.allow_messages === false) {
      disabledReason = "This user has disabled direct messages.";
      if (statusText) statusText.textContent = "Direct messages disabled";
    }
  }

  const disabled = !!disabledReason;
  [body, media, recordBtn].forEach((el) => {
    if (el) el.disabled = disabled;
  });
  const hasDirect = !!activeId;
  [profileBtn, removeBtn, blockBtn].forEach((el) => {
    if (el) el.style.display = hasDirect ? "inline-flex" : "none";
  });

  if (status) {
    if (disabled) {
      status.textContent = disabledReason;
      status.style.display = "block";
    } else {
      status.style.display = "none";
    }
  }
}

function subscribeToMessages(threadId) {
  // Unsubscribe from previous channel
  if (state.channel) {
    try {
      supabase.removeChannel(state.channel);
    } catch (e) {
      console.warn("Failed to remove old channel", e);
    }
  }
  
  // Create new subscription with automatic message loading
  state.channel = supabase
    .channel(`direct-${threadId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "direct_messages",
        filter: `thread_id=eq.${threadId}`
      },
      async (payload) => {
        // Add new message to state
        if (payload.new && !state.messages.find(m => m.id === payload.new.id)) {
          state.messages.push(payload.new);
          
          // Cache profile if not already cached
          if (!state.profileCache[payload.new.sender_id]) {
            const result = await supabase
              .from("profiles")
              .select("*")
              .eq("id", payload.new.sender_id)
              .single();
            if (result.data) {
              state.profileCache[payload.new.sender_id] = result.data;
            }
          }
          
          renderMessages();
          
          // Update thread previews for sidebar
          await loadThreadPreviews();
          renderFriendList();
          renderGroupList();
        }
      }
    )
    .subscribe();
}

async function selectFriend(friendId) {
  if (!friendId) return;
  state.activeFriendId = friendId;
  state.activeGroupId = null;
  renderFriendList();
  renderGroupList();
  const profile = state.friendProfiles[friendId];
  const avatar = document.getElementById("chatAvatar");
  const name = document.getElementById("chatName");
  const statusText = document.getElementById("chatStatusText");
  const profileBtn = document.getElementById("chatProfileBtn");
  const removeBtn = document.getElementById("chatRemoveBtn");
  const blockBtn = document.getElementById("chatBlockBtn");
  if (avatar) {
    avatar.src = profile?.avatar_url || "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80";
  }
  if (name) name.textContent = profile?.display_name || "Friend";
  if (statusText) statusText.textContent = profile?.headline || "Available";
  if (profileBtn) profileBtn.href = `profile.html?id=${encodeURIComponent(friendId)}`;
  if (removeBtn) {
    removeBtn.onclick = async () => {
      if (!confirm("Remove this friend?")) return;
      const row = getFriendshipRow(friendId);
      if (!row) return;
      await supabase.from("friendships").delete().eq("id", row.id);
      await loadFriendships();
      await loadThreadPreviews();
      state.activeFriendId = null;
      renderFriendList();
      renderRequests();
      renderBlockedList();
      renderMessages();
      updateChatFormState();
    };
  }
  if (blockBtn) {
    blockBtn.onclick = async () => {
      if (!confirm("Block this user? You will no longer receive messages.")) return;
      const row = getFriendshipRow(friendId);
      const now = new Date().toISOString();
      if (row) {
        await supabase
          .from("friendships")
          .update({ status: "blocked", blocked_by: state.user.id, updated_at: now })
          .eq("id", row.id);
      } else {
        await supabase.from("friendships").insert({
          id: crypto.randomUUID(),
          requester_id: state.user.id,
          requester_name: getDisplayName(state.user),
          addressee_id: friendId,
          status: "blocked",
          blocked_by: state.user.id,
          created_at: now,
          updated_at: now
        });
      }
      await loadFriendships();
      await loadThreadPreviews();
      state.activeFriendId = null;
      renderFriendList();
      renderRequests();
      renderBlockedList();
      renderMessages();
      updateChatFormState();
    };
  }
  const threadId = getThreadId(friendId);
  await loadMessages(threadId);
  subscribeToMessages(threadId);
  updateChatFormState();
  setChatView("chat");
}

async function selectGroup(groupId) {
  if (!groupId) return;
  state.activeGroupId = groupId;
  state.activeFriendId = null;
  renderFriendList();
  renderGroupList();
  const group = state.groups.find((item) => item.id === groupId);
  const avatar = document.getElementById("chatAvatar");
  const name = document.getElementById("chatName");
  const statusText = document.getElementById("chatStatusText");
  if (avatar) {
    avatar.src =
      "https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=120&q=80";
  }
  if (name) name.textContent = group?.name || "Group";
  if (statusText) statusText.textContent = "Group chat";
  await loadGroupMembers(groupId);
  await loadMessages(groupId);
  subscribeToMessages(groupId);
  updateChatFormState();
  setChatView("chat");
}

function setupChatForm() {
  const form = document.getElementById("chatForm");
  const status = document.getElementById("chatStatus");
  const mediaInput = document.getElementById("chatMedia");
  const preview = document.getElementById("chatMediaPreview");
  const recordBtn = document.getElementById("recordVoiceBtn");
  let mediaFile = null;
  let mediaType = "";
  let previewUrl = "";
  let recorder = null;
  let recordChunks = [];

  if (!form) return;

  if (mediaInput) {
    mediaInput.addEventListener("change", () => {
      const file = mediaInput.files[0];
      if (!file) {
        mediaFile = null;
        mediaType = "";
        if (preview) preview.innerHTML = "";
        return;
      }
      mediaFile = file;
      if (file.type.startsWith("video")) {
        mediaType = "video";
      } else if (file.type.startsWith("audio")) {
        mediaType = "audio";
      } else {
        mediaType = "image";
      }
      if (preview) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(file);
        preview.innerHTML = mediaType === "video"
          ? `<video controls src="${previewUrl}"></video>`
          : mediaType === "audio"
            ? `<audio controls src="${previewUrl}"></audio>`
            : `<img src="${previewUrl}" alt="preview">`;
      }
    });
  }

  if (recordBtn) {
    recordBtn.addEventListener("click", async () => {
      if (recorder && recorder.state === "recording") {
        recorder.stop();
        recordBtn.textContent = "Record voice";
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recorder = new MediaRecorder(stream);
        recordChunks = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size > 0) recordChunks.push(event.data);
        };
        recorder.onstop = () => {
          const blob = new Blob(recordChunks, { type: recorder.mimeType || "audio/webm" });
          mediaFile = new File([blob], `voice-${Date.now()}.webm`, { type: blob.type });
          mediaType = "audio";
          if (preview) {
            if (previewUrl) URL.revokeObjectURL(previewUrl);
            previewUrl = URL.createObjectURL(mediaFile);
            preview.innerHTML = `<audio controls src="${previewUrl}"></audio>`;
          }
        };
        recorder.start();
        recordBtn.textContent = "Stop recording";
      } catch (error) {
        if (status) {
          status.textContent = "Microphone access denied.";
          status.style.display = "block";
        }
      }
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = document.getElementById("chatBody").value.trim();
    if (!state.activeFriendId && !state.activeGroupId) {
      if (status) {
        status.textContent = "Select a chat first.";
        status.style.display = "block";
      }
      return;
    }
    if (state.activeFriendId) {
      const friendship = getFriendshipRow(state.activeFriendId);
      if (friendship?.status === "blocked") {
        if (status) {
          status.textContent = "This chat is blocked.";
          status.style.display = "block";
        }
        return;
      }
      const targetProfile = state.friendProfiles[state.activeFriendId];
      if (targetProfile && targetProfile.allow_messages === false) {
        if (status) {
          status.textContent = "This user has disabled direct messages.";
          status.style.display = "block";
        }
        return;
      }
    }
    if (!body && !mediaFile) {
      if (status) {
        status.textContent = "Write a message or attach media.";
        status.style.display = "block";
      }
      return;
    }

    let mediaUrl = "";
    if (mediaFile) {
      mediaUrl = await uploadMedia(mediaFile, "direct-messages");
      if (!mediaUrl) {
        if (status) {
          status.textContent = "Upload failed.";
          status.style.display = "block";
        }
        return;
      }
    }

    const payload = {
      id: crypto.randomUUID(),
      thread_id: state.activeGroupId || getThreadId(state.activeFriendId),
      sender_id: state.user.id,
      recipient_id: state.activeFriendId || null,
      body,
      media_url: mediaUrl,
      media_type: mediaType || "",
      created_at: new Date().toISOString()
    };
    const result = await supabase.from("direct_messages").insert(payload);
    if (result.error && status) {
      status.textContent = result.error.message || "Message failed.";
      status.style.display = "block";
      return;
    }
    
    // Immediately add message to state and display it
    state.messages.push(payload);
    renderMessages();
    
    form.reset();
    mediaFile = null;
    mediaType = "";
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = "";
    }
    if (preview) preview.innerHTML = "";
    if (status) status.style.display = "none";
    
    // Reload thread previews to show latest message
    await loadThreadPreviews();
    renderFriendList();
    renderGroupList();
  });

  updateChatFormState();
}

function setupChatSearch() {
  const input = document.getElementById("chatSearch");
  if (!input) return;
  input.addEventListener("input", (event) => {
    state.searchTerm = event.target.value || "";
    renderFriendList();
    renderGroupList();
  });
}

function setupPeopleSearch() {
  const input = document.getElementById("peopleSearch");
  if (!input) return;
  input.addEventListener("input", async (event) => {
    const value = event.target.value || "";
    await searchPeople(value);
  });
}

function setupChatNavigation() {
  const backBtn = document.getElementById("chatBackBtn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      setChatView("list");
    });
  }
}

function setupGroupCreation() {
  const btn = document.getElementById("newGroupBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    showFriendPicker();
  });

  // Modal elements
  const modal = document.getElementById("friendPickerModal");
  const close = document.getElementById("friendPickerClose");
  const cancel = document.getElementById("friendPickerCancel");
  const create = document.getElementById("friendPickerCreate");
  const pickerSearch = document.getElementById("pickerSearch");
  const pickerList = document.getElementById("pickerList");
  const groupNameInput = document.getElementById("groupNameInput");

  if (close) close.addEventListener("click", hideFriendPicker);
  if (cancel) cancel.addEventListener("click", hideFriendPicker);

  if (pickerSearch) {
    pickerSearch.addEventListener("input", async (e) => {
      const q = e.target.value || "";
      renderFriendPickerList(q);
    });
  }

  if (create) {
    create.addEventListener("click", async () => {
      const selected = Array.from(pickerList.querySelectorAll('.picker-item.selected')).map((el) => el.dataset.id);
      const name = (groupNameInput && groupNameInput.value && groupNameInput.value.trim()) || null;
      if (!name) {
        alert('Please enter a group name.');
        return;
      }
      const memberIds = new Set([state.user.id, ...selected]);
      const threadId = crypto.randomUUID();
      const now = new Date().toISOString();
      const createThread = await supabase.from("chat_threads").insert({
        id: threadId,
        name,
        is_group: true,
        created_by: state.user.id,
        created_at: now
      });
      if (createThread.error) {
        console.error("Error creating thread:", createThread.error);
        alert(createThread.error.message || "Group creation failed.");
        return;
      }
      const memberPayload = Array.from(memberIds).map((userId) => ({
        id: crypto.randomUUID(),
        user_id: userId,
        role: userId === state.user.id ? "owner" : "member",
        joined_at: now
      }));
      // Use the RPC helper to add members in a single trusted call to avoid RLS insert failures
      const memberResult = await supabase.rpc("add_chat_members", { thread: threadId, members: memberPayload });
      if (memberResult.error) {
        console.error("Error creating members via RPC:", memberResult.error);
        // Fallback: attempt direct insert (may fail if RLS blocks)
        try {
          const fallback = await supabase.from("chat_members").insert(
            memberPayload.map((m) => ({ ...m, thread_id: threadId }))
          );
          if (fallback.error) throw fallback.error;
        } catch (err) {
          console.error("Error creating members:", err);
          alert(err.message || "Group members failed.");
          return;
        }
      }
      hideFriendPicker();
      await loadGroups();
      await loadThreadPreviews();
      renderGroupList();
      await selectGroup(threadId);
    });
  }
}

let __friendPickerEscHandler = null;
function showFriendPicker() {
  const modal = document.getElementById("friendPickerModal");
  const pickerList = document.getElementById("pickerList");
  const pickerSearch = document.getElementById("pickerSearch");
  const groupNameInput = document.getElementById("groupNameInput");
  if (!modal) return;
  modal.classList.remove("hidden");
  modal.setAttribute("aria-hidden", "false");
  // populate list
  if (pickerSearch) pickerSearch.value = "";
  if (groupNameInput) {
    groupNameInput.value = "";
    try { groupNameInput.focus(); } catch (e) {}
  }
  renderFriendPickerList();
  // add escape key handler
  __friendPickerEscHandler = function (e) {
    if (e.key === 'Escape') hideFriendPicker();
  };
  document.addEventListener('keydown', __friendPickerEscHandler);
}

function hideFriendPicker() {
  const modal = document.getElementById("friendPickerModal");
  if (!modal) return;
  modal.classList.add("hidden");
  modal.setAttribute("aria-hidden", "true");
  if (__friendPickerEscHandler) {
    document.removeEventListener('keydown', __friendPickerEscHandler);
    __friendPickerEscHandler = null;
  }
}

function renderFriendPickerList(query = "") {
  const pickerList = document.getElementById("pickerList");
  const noResults = document.getElementById("pickerNoResults");
  if (!pickerList) return;
  const q = query.trim().toLowerCase();
  const friends = state.friends
    .map((id) => ({ id, profile: state.friendProfiles[id] }))
    .filter(Boolean)
    .filter((item) => {
      if (!q) return true;
      const name = (item.profile?.display_name || "").toLowerCase();
      const username = (item.profile?.username || "").toLowerCase();
      const email = (item.profile?.email || "").toLowerCase();
      return name.includes(q) || username.includes(q) || email.includes(q);
    });
  if (!friends.length) {
    pickerList.innerHTML = "";
    if (noResults) noResults.style.display = "block";
    return;
  }
  if (noResults) noResults.style.display = "none";
  pickerList.innerHTML = friends
    .map((item) => `
      <div class="picker-item" data-id="${item.id}" tabindex="0">
        <img src="${isSafeUrl(item.profile?.avatar_url) ? escapeHTML(item.profile?.avatar_url) : 'https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80'}" alt="">
        <div class="meta">
          <div class="name">${escapeHTML(item.profile?.display_name || 'Member')}</div>
          <div class="sub">${escapeHTML(item.profile?.username || item.profile?.email || '')}</div>
        </div>
      </div>
    `)
    .join("");

  pickerList.querySelectorAll('.picker-item').forEach((el) => {
    el.addEventListener('click', () => {
      el.classList.toggle('selected');
    });
    el.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        el.classList.toggle('selected');
      }
    });
  });
}

async function boot() {
  setupReveal();
  const settings = await fetchSettings();
  if (settings.themeId) {
    const theme = await fetchThemeById(settings.themeId);
    if (theme) applyThemeVariables(theme);
  }

  state.user = await getCurrentUserWithRole();
  if (!state.user) {
    window.location.href = "login.html?next=chat.html";
    return;
  }
  renderAuthActions();
  setChatView("list");
  const headerAvatar = document.getElementById("chatAvatar");
  if (headerAvatar) {
    headerAvatar.src = "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80";
  }

  await loadFriendships();
  await loadGroups();
  await loadThreadPreviews();
  renderGroupList();
  renderFriendList();
  renderRequests();
  renderBlockedList();
  renderPeopleResults();
  setupChatForm();
  setupChatSearch();
  setupPeopleSearch();
  setupGroupCreation();
  setupChatNavigation();
  renderMessages();

  const params = new URLSearchParams(window.location.search);
  const friendId = params.get("user");
  if (friendId && state.friends.includes(friendId)) {
    await selectFriend(friendId);
  }
}

boot().catch((error) => {
  reportAppError(error, "Chat load failed");
  const message = extractErrorMessage(error, "Unable to load chat right now.");
  const list = document.getElementById("chatMessages");
  if (list) {
    list.innerHTML = `<div class="callout">Chat failed to load: ${escapeHTML(message)}</div>`;
  }
  const status = document.getElementById("chatStatus");
  if (status) {
    status.textContent = message;
    status.style.display = "block";
  }
});
