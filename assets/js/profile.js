import { supabase, getCurrentUser, getCurrentUserWithRole, getDisplayName, getUserRole, signOut } from "./supabase.js";
import { uploadMedia } from "./media.js";
import {
  fetchBookmarks,
  fetchNotifications,
  markNotificationRead,
  markAllNotificationsRead,
  createAdminRequest
} from "./data.js";
import { fetchSettings } from "./settings.js";
import { fetchThemeById, applyThemeVariables } from "./themes.js";
import {
  timeAgo,
  clampText,
  stripHTML,
  escapeHTML,
  getQueryParam,
  deriveLevel,
  isSafeUrl,
  extractErrorMessage,
  reportAppError
} from "./utils.js";
import { setupReveal } from "./reveal.js";
import "./nav.js";

const state = {
  user: null,
  profile: null,
  viewingId: null,
  friendship: null,
  friendCount: null,
  friendSummary: [],
  activity: {
    topics: [],
    comments: [],
    shares: [],
    posts: {}
  },
  bookmarks: [],
  notifications: [],
  adminRequest: null
};

function sanitizeUsername(value = "") {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^_+|_+$/g, "");
}

async function isUsernameAvailable(username, currentId) {
  if (!username) return true;
  const result = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", username)
    .neq("id", currentId)
    .limit(1)
    .maybeSingle();
  return !result.data;
}

let setActiveProfileSection = null;

function renderAuthActions() {
  const actions = document.getElementById("authActions");
  if (!actions) return;
  actions.innerHTML = "";
  if (state.user) {
    const label = document.createElement("span");
    label.className = "auth-meta";
    label.textContent = getDisplayName(state.user);
    const role = getUserRole(state.user);
    if (["author", "moderator", "admin", "super"].includes(role)) {
      const authorPanel = document.createElement("a");
      authorPanel.className = "btn ghost";
      authorPanel.href = "author/dashboard.html";
      authorPanel.textContent = "Author Studio";
      actions.appendChild(authorPanel);
    }
    if (["moderator", "admin", "super"].includes(role)) {
      const modPanel = document.createElement("a");
      modPanel.className = "btn ghost";
      modPanel.href = "moderator/dashboard.html";
      modPanel.textContent = "Moderator Panel";
      actions.appendChild(modPanel);
    }
    if (["admin", "super"].includes(role)) {
      const adminPanel = document.createElement("a");
      adminPanel.className = "btn ghost";
      adminPanel.href = "admin/dashboard.html";
      adminPanel.textContent = "Admin Dashboard";
      actions.appendChild(adminPanel);
    }
    const chat = document.createElement("a");
    chat.className = "btn ghost";
    chat.href = "chat.html";
    chat.textContent = "Chat";
    const logout = document.createElement("button");
    logout.className = "btn ghost";
    logout.textContent = "Log Out";
    logout.addEventListener("click", async () => {
      await signOut();
      window.location.reload();
    });
    actions.appendChild(label);
    actions.appendChild(chat);
    actions.appendChild(logout);
  } else {
    const login = document.createElement("a");
    login.className = "btn ghost";
    login.href = "login.html?next=profile.html";
    login.textContent = "Log In";
    actions.appendChild(login);
  }
}

async function ensureProfile(user) {
  if (!user) return null;
  const existing = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!existing.error && existing.data) return existing.data;
  const fallbackName = getDisplayName(user);
  const fallbackEmail = user.email || "";
  const fallbackUsername = fallbackEmail ? fallbackEmail.split("@")[0] : fallbackName || "member";
  const payload = {
    id: user.id,
    display_name: fallbackName,
    username: user.user_metadata?.username || fallbackUsername,
    email: fallbackEmail,
    bio: "",
    avatar_url: "",
    role: user.user_metadata?.role || "user",
    headline: "",
    location: "",
    website: "",
    cover_url: "",
    allow_messages: true,
    allow_requests: true,
    show_email: false,
    notify_messages: true,
    notify_replies: true,
    created_at: new Date().toISOString()
  };
  const created = await supabase.from("profiles").insert(payload).select().single();
  return created.data || null;
}

async function loadProfile(viewingId) {
  const result = await supabase.from("profiles").select("*").eq("id", viewingId).maybeSingle();
  return result.data || null;
}

async function loadFriendship() {
  if (!state.user || !state.viewingId || state.viewingId === state.user.id) return null;
  const result = await supabase
    .from("friendships")
    .select("*")
    .or(
      `and(requester_id.eq.${state.user.id},addressee_id.eq.${state.viewingId}),and(requester_id.eq.${state.viewingId},addressee_id.eq.${state.user.id})`
    )
    .maybeSingle();
  state.friendship = result.data || null;
}

async function loadFriendSummary() {
  state.friendCount = null;
  state.friendSummary = [];
  if (!state.user || state.viewingId !== state.user.id) return;
  const result = await supabase
    .from("friendships")
    .select("*")
    .eq("status", "accepted")
    .or(`requester_id.eq.${state.user.id},addressee_id.eq.${state.user.id}`);
  const friendships = result.data || [];
  const friendIds = friendships
    .map((row) => (row.requester_id === state.user.id ? row.addressee_id : row.requester_id))
    .filter(Boolean);
  state.friendCount = friendIds.length;
  if (!friendIds.length) return;
  const profiles = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", friendIds);
  state.friendSummary = profiles.data || [];
}

function renderProfileAbout() {
  const about = document.getElementById("profileAbout");
  if (!about) return;
  const items = [];
  const headline = state.profile?.headline;
  const location = state.profile?.location;
  const website = state.profile?.website;
  const username = state.profile?.username;
  if (username) {
    items.push(`<div class="about-item"><span>Username</span>${escapeHTML(username)}</div>`);
  }
  if (headline) {
    items.push(`<div class="about-item"><span>Headline</span>${escapeHTML(headline)}</div>`);
  }
  if (location) {
    items.push(`<div class="about-item"><span>Location</span>${escapeHTML(location)}</div>`);
  }
  if (website) {
    const safeUrl = website.startsWith("http://") || website.startsWith("https://")
      ? website
      : `https://${website}`;
    if (safeUrl.startsWith("http://") || safeUrl.startsWith("https://")) {
      items.push(
        `<div class="about-item"><span>Website</span><a href="${safeUrl}" target="_blank" rel="noopener">${escapeHTML(website)}</a></div>`
      );
    }
  }
  if (state.profile?.show_email) {
    const email =
      state.user && state.user.id === state.viewingId
        ? state.user.email
        : state.profile?.email;
    if (email) {
      items.push(`<div class="about-item"><span>Email</span>${escapeHTML(email)}</div>`);
    }
  }
  if (state.profile?.created_at) {
    items.push(
      `<div class="about-item"><span>Member since</span>${new Date(
        state.profile.created_at
      ).toLocaleDateString()}</div>`
    );
  }
  if (!items.length) {
    about.innerHTML = "<div class=\"callout\">Add profile details to tell others about you.</div>";
    return;
  }
  about.innerHTML = items.join("");
}

function renderProfileFriends() {
  const list = document.getElementById("profileFriends");
  if (!list) return;
  if (!state.user || state.viewingId !== state.user.id) {
    list.innerHTML = "<div class=\"callout\">Friends list is private.</div>";
    return;
  }
  if (!state.friendSummary.length) {
    list.innerHTML = "<div class=\"callout\">No friends yet — start connecting.</div>";
    return;
  }
  list.innerHTML = state.friendSummary
    .slice(0, 6)
    .map(
      (friend) => `
        <div class="friend-pill">
          <img src="${friend.avatar_url || "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80"}" alt="friend avatar">
          <div class="friend-name">${escapeHTML(friend.display_name || "Member")}</div>
        </div>
      `
    )
    .join("");
}

function renderProfile() {
  const avatar = document.getElementById("profileAvatar");
  const cover = document.getElementById("profileCoverImg");
  const name = document.getElementById("profileName");
  const bio = document.getElementById("profileBio");
  const role = document.getElementById("profileRole");
  const headline = document.getElementById("profileHeadline");
  const badgeWrap = document.getElementById("profileBadges");
  if (avatar) {
    avatar.src = state.profile?.avatar_url || "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80";
  }
  if (cover) {
    cover.src = state.profile?.cover_url || "https://images.unsplash.com/photo-1482192596544-9eb780fc7f66?auto=format&fit=crop&w=1200&q=80";
  }
  if (name) {
    const displayName = state.profile?.display_name || "Member";
    const badge = state.profile?.is_verified
      ? `<span class="verified-badge" title="Verified">✓</span>`
      : "";
    name.innerHTML = `${escapeHTML(displayName)}${badge}`;
  }
  if (headline) {
    headline.textContent = state.profile?.headline || "Tech community member";
  }
  if (bio) bio.textContent = state.profile?.bio || "No bio yet.";
  if (role) role.textContent = state.profile?.role || "Member";
  if (badgeWrap) {
    const badges = [];
    if (state.profile?.is_featured) badges.push('<span class="badge-chip featured">Featured</span>');
    if (state.profile?.is_staff_pick) badges.push('<span class="badge-chip staff">Staff Pick</span>');
    badgeWrap.innerHTML = badges.join("");
  }
}

function renderVerification() {
  const target = document.getElementById("profileVerification");
  if (!target) return;
  const tier = state.profile?.verification_tier || "standard";
  const verified = !!state.profile?.is_verified;
  const perks = {
    standard: [
      "Standard profile visibility across the community.",
      "Access to comments, discussions, and messaging.",
      "Standard support response times."
    ],
    pro: [
      "Verified badge on profile and author cards.",
      "Priority placement in community directories.",
      "Early access to new creator tools."
    ],
    elite: [
      "Featured author spotlight placements.",
      "Fast-track moderation for posts.",
      "Dedicated creator support channel."
    ]
  };
  const perkList = perks[verified ? tier : "standard"] || perks.standard;
  if (!verified) {
    target.innerHTML = `
      <div class="callout">Standard account (verification is optional)</div>
      <ul class="perk-list">
        ${perkList.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}
      </ul>
    `;
    return;
  }
  const tierLabel = tier.charAt(0).toUpperCase() + tier.slice(1);
  const verifiedAt = state.profile?.verified_at
    ? new Date(state.profile.verified_at).toLocaleDateString()
    : null;
  target.innerHTML = `
    <div class="verification-tier">Verified ${escapeHTML(tierLabel)}${verifiedAt ? ` · since ${verifiedAt}` : ""}</div>
    <ul class="perk-list">
      ${perkList.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}
    </ul>
  `;
}

function setupProfileTabs() {
  const tabs = document.querySelectorAll("#profileTabs button");
  const sections = document.querySelectorAll("[data-profile-section]");
  if (!tabs.length || !sections.length) return;

  const isSelf = state.user && state.viewingId === state.user.id;
  if (!isSelf) {
    tabs.forEach((btn) => {
      if (["settings", "bookmarks", "notifications"].includes(btn.dataset.tab)) {
        btn.style.display = "none";
      }
    });
  }

  const setActive = (tabId) => {
    if (!isSelf && ["settings", "bookmarks", "notifications"].includes(tabId)) {
      tabId = "overview";
    }
    tabs.forEach((btn) => btn.classList.toggle("active", btn.dataset.tab === tabId));
    sections.forEach((section) => {
      section.classList.toggle("active", section.dataset.profileSection === tabId);
    });
  };
  setActiveProfileSection = setActive;

  tabs.forEach((btn) => {
    btn.addEventListener("click", () => setActive(btn.dataset.tab));
  });

  const params = new URLSearchParams(window.location.search);
  const defaultTab = params.get("tab") || "overview";
  setActive(defaultTab);
}

function renderProfileStats() {
  const stats = document.getElementById("profileStats");
  if (!stats) return;
  const friendValue = typeof state.friendCount === "number" ? state.friendCount : "Private";
  const points = state.profile?.points || 0;
  const level = state.profile?.level || deriveLevel(points).label;
  stats.innerHTML = [
    { label: "Topics", value: state.activity.topics.length },
    { label: "Comments", value: state.activity.comments.length },
    { label: "Shares", value: state.activity.shares.length },
    { label: "Friends", value: friendValue },
    { label: "Reputation", value: `${points} · ${level}` }
  ]
    .map(
      (item) => `
      <div class="stats-item">
        <span>${escapeHTML(item.label)}</span>
        <strong>${item.value}</strong>
      </div>
    `
    )
    .join("");
}

function renderActivity() {
  const topicsEl = document.getElementById("profileTopics");
  const commentsEl = document.getElementById("profileComments");
  const sharesEl = document.getElementById("profileShares");

  if (topicsEl) {
    topicsEl.innerHTML = state.activity.topics.length
      ? state.activity.topics
          .slice(0, 6)
          .map(
            (topic) => `
        <div class="activity-item">
          <a href="discussion.html?topic=${topic.id}"><strong>${escapeHTML(topic.title)}</strong></a>
          <div class="topic-meta">${timeAgo(topic.created_at)}</div>
          <div>${escapeHTML(clampText(topic.description || "", 120))}</div>
        </div>
      `
          )
          .join("")
      : "<div class=\"callout\">No topics yet.</div>";
  }

  if (commentsEl) {
    commentsEl.innerHTML = state.activity.comments.length
      ? state.activity.comments
          .slice(0, 6)
          .map((comment) => {
            const post = state.activity.posts[comment.post_id];
            return `
          <div class="activity-item">
            <a href="post.html?id=${comment.post_id}"><strong>${escapeHTML(
              post?.title || "Post"
            )}</strong></a>
            <div class="topic-meta">${timeAgo(comment.created_at)}</div>
            <div>${escapeHTML(clampText(stripHTML(comment.body || ""), 120))}</div>
          </div>
        `;
          })
          .join("")
      : "<div class=\"callout\">No comments yet.</div>";
  }

  if (sharesEl) {
    sharesEl.innerHTML = state.activity.shares.length
      ? state.activity.shares
          .slice(0, 6)
          .map((share) => {
            const post = state.activity.posts[share.post_id];
            return `
          <div class="activity-item">
            <a href="post.html?id=${share.post_id}"><strong>${escapeHTML(
              post?.title || "Post"
            )}</strong></a>
            <div class="topic-meta">${timeAgo(share.created_at)} · ${escapeHTML(
              share.channel || "share"
            )}</div>
          </div>
        `;
          })
          .join("")
      : "<div class=\"callout\">No shares yet.</div>";
  }
}

function renderBookmarks() {
  const list = document.getElementById("profileBookmarks");
  if (!list) return;
  if (!state.user || state.viewingId !== state.user.id) {
    list.innerHTML = "<div class=\"callout\">Bookmarks are private.</div>";
    return;
  }
  if (!state.bookmarks.length) {
    list.innerHTML = "<div class=\"callout\">No saved posts yet — bookmark something you love.</div>";
    return;
  }
  list.innerHTML = state.bookmarks
    .map((item) => {
      const post = item.posts || {};
      return `
        <div class="activity-item">
          <a href="post.html?id=${item.post_id}"><strong>${escapeHTML(
            post.title || "Saved post"
          )}</strong></a>
          <div class="topic-meta">Saved ${timeAgo(item.created_at)}</div>
        </div>
      `;
    })
    .join("");
}

function renderNotifications() {
  const list = document.getElementById("profileNotifications");
  if (!list) return;
  if (!state.user || state.viewingId !== state.user.id) {
    list.innerHTML = "<div class=\"callout\">Notifications are private.</div>";
    return;
  }
  if (!state.notifications.length) {
    list.innerHTML = "<div class=\"callout\">No notifications yet.</div>";
    return;
  }
  list.innerHTML = state.notifications
    .map((note) => {
      const unread = !note.read_at;
      const title = escapeHTML(note.title || "Notification");
      const body = escapeHTML(note.body || "");
      const timeLabel = timeAgo(note.created_at);
      const linkTarget = note.link || note.link_url || "";
      const link = linkTarget ? `<a href="${linkTarget}">Open</a>` : "";
      return `
        <div class="notification-item ${unread ? "unread" : ""}" data-id="${note.id}">
          <strong>${title}</strong>
          <div>${body}</div>
          <div class="leaderboard-meta">
            <span>${timeLabel}</span>
            ${link}
          </div>
        </div>
      `;
    })
    .join("");

  list.querySelectorAll(".notification-item").forEach((item) => {
    item.addEventListener("click", async () => {
      const id = item.dataset.id;
      if (!id) return;
      await markNotificationRead(id);
      item.classList.remove("unread");
    });
  });
}

async function sendFriendRequest() {
  if (!state.user || !state.viewingId) return;
  await supabase.from("friendships").insert({
    id: crypto.randomUUID(),
    requester_id: state.user.id,
    requester_name: getDisplayName(state.user),
    addressee_id: state.viewingId,
    status: "pending",
    created_at: new Date().toISOString()
  });
  await loadFriendship();
  renderProfileActions();
}

async function acceptFriendRequest() {
  if (!state.friendship) return;
  await supabase
    .from("friendships")
    .update({ status: "accepted", updated_at: new Date().toISOString() })
    .eq("id", state.friendship.id);
  await loadFriendship();
  renderProfileActions();
}

async function declineFriendRequest() {
  if (!state.friendship) return;
  await supabase.from("friendships").delete().eq("id", state.friendship.id);
  state.friendship = null;
  renderProfileActions();
}

async function removeFriendship() {
  if (!state.friendship) return;
  if (!confirm("Remove this friend?")) return;
  await supabase.from("friendships").delete().eq("id", state.friendship.id);
  state.friendship = null;
  renderProfileActions();
}

async function blockUser() {
  if (!state.user || !state.viewingId) return;
  if (!confirm("Block this user? You will no longer receive messages.")) return;
  const now = new Date().toISOString();
  if (state.friendship) {
    await supabase
      .from("friendships")
      .update({ status: "blocked", blocked_by: state.user.id, updated_at: now })
      .eq("id", state.friendship.id);
  } else {
    await supabase.from("friendships").insert({
      id: crypto.randomUUID(),
      requester_id: state.user.id,
      requester_name: getDisplayName(state.user),
      addressee_id: state.viewingId,
      status: "blocked",
      blocked_by: state.user.id,
      created_at: now,
      updated_at: now
    });
  }
  await loadFriendship();
  renderProfileActions();
}

async function unblockUser() {
  if (!state.friendship) return;
  await supabase.from("friendships").delete().eq("id", state.friendship.id);
  state.friendship = null;
  renderProfileActions();
}

function renderProfileActions() {
  const actions = document.getElementById("profileActions");
  if (!actions) return;
  actions.innerHTML = "";
  if (!state.user) {
    const login = document.createElement("a");
    login.className = "btn ghost";
    login.href = "login.html?next=profile.html";
    login.textContent = "Log in to connect";
    actions.appendChild(login);
    return;
  }
  const isSelf = state.user.id === state.viewingId;
  if (isSelf) {
    const edit = document.createElement("button");
    edit.className = "btn";
    edit.textContent = "Edit Profile";
    edit.addEventListener("click", () => {
      // First, switch to settings tab
      if (setActiveProfileSection) setActiveProfileSection("settings");
      // Then make sure the editor is visible
      const editor = document.getElementById("profileEditor");
      if (editor) {
        editor.style.display = "block";
        editor.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      // Mark settings tab as active
      const settingsBtn = document.querySelector('[data-tab="settings"]');
      if (settingsBtn) settingsBtn.click();
    });
    const chat = document.createElement("a");
    chat.className = "btn ghost";
    chat.href = "chat.html";
    chat.textContent = "Open Chat";
    actions.appendChild(edit);
    actions.appendChild(chat);
    return;
  }

  const allowRequests = state.profile?.allow_requests !== false;
  const allowMessages = state.profile?.allow_messages !== false;

  if (state.friendship?.status === "blocked") {
    if (state.friendship.blocked_by === state.user.id) {
      const unblock = document.createElement("button");
      unblock.className = "btn ghost";
      unblock.textContent = "Unblock";
      unblock.addEventListener("click", unblockUser);
      actions.appendChild(unblock);
    } else {
      const blocked = document.createElement("span");
      blocked.className = "chip";
      blocked.textContent = "You are blocked";
      actions.appendChild(blocked);
    }
    return;
  }

  if (!state.friendship) {
    const addBtn = document.createElement("button");
    addBtn.className = "btn";
    addBtn.textContent = allowRequests ? "Add Friend" : "Requests closed";
    addBtn.disabled = !allowRequests;
    addBtn.addEventListener("click", sendFriendRequest);
    const blockBtn = document.createElement("button");
    blockBtn.className = "btn ghost";
    blockBtn.textContent = "Block";
    blockBtn.addEventListener("click", blockUser);
    actions.appendChild(addBtn);
    actions.appendChild(blockBtn);
    return;
  }

  if (state.friendship.status === "pending" && state.friendship.requester_id === state.user.id) {
    const sent = document.createElement("span");
    sent.className = "chip";
    sent.textContent = "Request sent";
    const cancel = document.createElement("button");
    cancel.className = "btn ghost";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", declineFriendRequest);
    const blockBtn = document.createElement("button");
    blockBtn.className = "btn ghost";
    blockBtn.textContent = "Block";
    blockBtn.addEventListener("click", blockUser);
    actions.appendChild(sent);
    actions.appendChild(cancel);
    actions.appendChild(blockBtn);
    return;
  }

  if (state.friendship.status === "pending" && state.friendship.addressee_id === state.user.id) {
    const accept = document.createElement("button");
    accept.className = "btn";
    accept.textContent = "Accept";
    accept.addEventListener("click", acceptFriendRequest);
    const decline = document.createElement("button");
    decline.className = "btn ghost";
    decline.textContent = "Decline";
    decline.addEventListener("click", declineFriendRequest);
    const blockBtn = document.createElement("button");
    blockBtn.className = "btn ghost";
    blockBtn.textContent = "Block";
    blockBtn.addEventListener("click", blockUser);
    actions.appendChild(accept);
    actions.appendChild(decline);
    actions.appendChild(blockBtn);
    return;
  }

  if (state.friendship.status === "accepted") {
    if (allowMessages) {
      const chat = document.createElement("a");
      chat.className = "btn";
      chat.href = `chat.html?user=${state.viewingId}`;
      chat.textContent = "Message";
      actions.appendChild(chat);
    } else {
      const disabled = document.createElement("span");
      disabled.className = "chip";
      disabled.textContent = "Messaging disabled";
      actions.appendChild(disabled);
    }

    const remove = document.createElement("button");
    remove.className = "btn ghost";
    remove.textContent = "Remove";
    remove.addEventListener("click", removeFriendship);
    const blockBtn = document.createElement("button");
    blockBtn.className = "btn ghost";
    blockBtn.textContent = "Block";
    blockBtn.addEventListener("click", blockUser);
    actions.appendChild(remove);
    actions.appendChild(blockBtn);
  }
}

function setupProfileEditor() {
  const editor = document.getElementById("profileEditor");
  const form = document.getElementById("profileForm");
  const status = document.getElementById("profileStatus");
  const avatarFile = document.getElementById("editAvatarFile");
  const avatarPreview = document.getElementById("editAvatarPreview");
  const coverFile = document.getElementById("editCoverFile");
  const coverPreview = document.getElementById("editCoverPreview");
  if (!editor || !form) return;
  if (!state.user || state.user.id !== state.viewingId) {
    editor.style.display = "none";
    return;
  }
  editor.style.display = "block";
  document.getElementById("editDisplayName").value = state.profile?.display_name || "";
  const usernameInput = document.getElementById("editUsername");
  if (usernameInput) {
    usernameInput.value = state.profile?.username || "";
  }
  document.getElementById("editHeadline").value = state.profile?.headline || "";
  document.getElementById("editBio").value = state.profile?.bio || "";
  document.getElementById("editLocation").value = state.profile?.location || "";
  document.getElementById("editWebsite").value = state.profile?.website || "";
  document.getElementById("editAvatarUrl").value = state.profile?.avatar_url || "";
  document.getElementById("editCoverUrl").value = state.profile?.cover_url || "";

  let avatarUploadFile = null;
  let avatarPreviewUrl = "";
  let coverUploadFile = null;
  let coverPreviewUrl = "";

  if (avatarPreview) {
    if (state.profile?.avatar_url && isSafeUrl(state.profile.avatar_url)) {
      avatarPreview.src = state.profile.avatar_url;
      avatarPreview.style.display = "block";
    } else {
      avatarPreview.style.display = "none";
    }
  }

  if (coverPreview) {
    if (state.profile?.cover_url && isSafeUrl(state.profile.cover_url)) {
      coverPreview.src = state.profile.cover_url;
      coverPreview.style.display = "block";
    } else {
      coverPreview.style.display = "none";
    }
  }

  if (avatarFile) {
    avatarFile.addEventListener("change", () => {
      const file = avatarFile.files[0];
      if (!file) {
        avatarUploadFile = null;
        if (avatarPreview) {
          avatarPreview.style.display = "none";
          avatarPreview.src = "";
        }
        return;
      }
      avatarUploadFile = file;
      if (avatarPreview) {
        if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
        avatarPreviewUrl = URL.createObjectURL(file);
        avatarPreview.src = avatarPreviewUrl;
        avatarPreview.style.display = "block";
      }
    });
  }

  if (coverFile) {
    coverFile.addEventListener("change", () => {
      const file = coverFile.files[0];
      if (!file) {
        coverUploadFile = null;
        if (coverPreview) {
          coverPreview.style.display = "none";
          coverPreview.src = "";
        }
        return;
      }
      coverUploadFile = file;
      if (coverPreview) {
        if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
        coverPreviewUrl = URL.createObjectURL(file);
        coverPreview.src = coverPreviewUrl;
        coverPreview.style.display = "block";
      }
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const displayName = document.getElementById("editDisplayName").value.trim();
    const rawUsername = document.getElementById("editUsername")?.value.trim() || "";
    const username = sanitizeUsername(rawUsername);
    const headline = document.getElementById("editHeadline").value.trim();
    const bio = document.getElementById("editBio").value.trim();
    const location = document.getElementById("editLocation").value.trim();
    const website = document.getElementById("editWebsite").value.trim();
    const avatarUrl = document.getElementById("editAvatarUrl").value.trim();
    const coverUrl = document.getElementById("editCoverUrl").value.trim();

    if (rawUsername && !username) {
      if (status) {
        status.textContent = "Use letters, numbers, or underscores for your username.";
        status.style.display = "block";
      }
      return;
    }
    if (username && !(await isUsernameAvailable(username, state.user.id))) {
      if (status) {
        status.textContent = "Username already taken. Try another one.";
        status.style.display = "block";
      }
      return;
    }

    let uploadedAvatar = "";
    let uploadedCover = "";
    if (avatarUploadFile) {
      uploadedAvatar = await uploadMedia(avatarUploadFile, "avatars");
      if (!uploadedAvatar && status) {
        status.textContent = "Avatar upload failed. Check your media bucket and permissions.";
        status.style.display = "block";
        return;
      }
    }
    if (coverUploadFile) {
      uploadedCover = await uploadMedia(coverUploadFile, "avatars");
      if (!uploadedCover && status) {
        status.textContent = "Cover upload failed. Check your media bucket and permissions.";
        status.style.display = "block";
        return;
      }
    }

    const result = await supabase
      .from("profiles")
      .update({
        display_name: displayName,
        username,
        headline,
        bio,
        location,
        website,
        email: state.user?.email || state.profile?.email || "",
        avatar_url: uploadedAvatar || avatarUrl || state.profile?.avatar_url || "",
        cover_url: uploadedCover || coverUrl || state.profile?.cover_url || "",
        updated_at: new Date().toISOString()
      })
      .eq("id", state.user.id)
      .select()
      .single();

    if (status) {
      status.textContent = result.error ? result.error.message || "Update failed." : "Profile updated.";
      status.style.display = "block";
    }
    if (!result.error && result.data) {
      state.profile = result.data;
      renderProfile();
      renderProfileAbout();
    }
  });
}

function setupPrivacyForm() {
  const form = document.getElementById("privacyForm");
  const status = document.getElementById("privacyStatus");
  if (!form || !state.profile || !state.user || state.user.id !== state.viewingId) return;
  document.getElementById("toggleMessages").checked = state.profile.allow_messages !== false;
  document.getElementById("toggleRequests").checked = state.profile.allow_requests !== false;
  document.getElementById("toggleEmail").checked = !!state.profile.show_email;
  document.getElementById("toggleMsgNotify").checked = state.profile.notify_messages !== false;
  document.getElementById("toggleReplyNotify").checked = state.profile.notify_replies !== false;
  const followToggle = document.getElementById("toggleFollowNotify");
  if (followToggle) followToggle.checked = state.profile.notify_follows !== false;
  const mentionToggle = document.getElementById("toggleMentionNotify");
  if (mentionToggle) mentionToggle.checked = state.profile.notify_mentions !== false;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const updates = {
      allow_messages: document.getElementById("toggleMessages").checked,
      allow_requests: document.getElementById("toggleRequests").checked,
      show_email: document.getElementById("toggleEmail").checked,
      notify_messages: document.getElementById("toggleMsgNotify").checked,
      notify_replies: document.getElementById("toggleReplyNotify").checked,
      notify_follows: document.getElementById("toggleFollowNotify")?.checked ?? true,
      notify_mentions: document.getElementById("toggleMentionNotify")?.checked ?? true,
      updated_at: new Date().toISOString()
    };
    const result = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", state.user.id)
      .select()
      .single();
    if (status) {
      status.textContent = result.error ? "Preferences update failed." : "Preferences saved.";
      status.style.display = "block";
    }
    if (!result.error && result.data) {
      state.profile = result.data;
      renderProfileActions();
      renderProfileAbout();
    }
  });
}

function setupSecurityForm() {
  const form = document.getElementById("securityForm");
  const status = document.getElementById("securityStatus");
  if (!form || !state.user || state.user.id !== state.viewingId) return;
  const emailInput = document.getElementById("securityEmail");
  if (emailInput) emailInput.value = state.user.email || "";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const newEmail = document.getElementById("securityNewEmail").value.trim();
    const password = document.getElementById("securityPassword").value.trim();
    const confirm = document.getElementById("securityPasswordConfirm").value.trim();

    if (!newEmail && !password) {
      if (status) {
        status.textContent = "Enter a new email or password.";
        status.style.display = "block";
      }
      return;
    }

    if (password && password !== confirm) {
      if (status) {
        status.textContent = "Passwords do not match.";
        status.style.display = "block";
      }
      return;
    }

    const updates = {};
    if (newEmail) updates.email = newEmail;
    if (password) updates.password = password;

    const result = await supabase.auth.updateUser(updates);
    if (status) {
      status.textContent = result.error
        ? result.error.message || "Security update failed."
        : "Security updated. Check your email if confirmation is required.";
      status.style.display = "block";
    }
    if (!result.error) {
      document.getElementById("securityPassword").value = "";
      document.getElementById("securityPasswordConfirm").value = "";
      if (newEmail) {
        document.getElementById("securityNewEmail").value = "";
        await supabase
          .from("profiles")
          .update({ email: newEmail, updated_at: new Date().toISOString() })
          .eq("id", state.user.id);
      }
    }
  });
}

function setupNotificationActions() {
  const btn = document.getElementById("markAllReadBtn");
  if (!btn || !state.user || state.viewingId !== state.user.id) return;
  btn.addEventListener("click", async () => {
    await markAllNotificationsRead(state.user.id);
    await loadNotifications();
    renderNotifications();
  });
}

async function loadActivity() {
  const [topicsRes, commentsRes, sharesRes] = await Promise.all([
    supabase.from("discussion_topics").select("id, title, description, created_at").eq("author_id", state.viewingId).order("created_at", { ascending: false }),
    supabase.from("comments").select("id, post_id, body, created_at").eq("author_id", state.viewingId).order("created_at", { ascending: false }),
    supabase.from("post_shares").select("id, post_id, channel, created_at").eq("user_id", state.viewingId).order("created_at", { ascending: false })
  ]);

  state.activity.topics = topicsRes.data || [];
  state.activity.comments = commentsRes.data || [];
  state.activity.shares = sharesRes.data || [];

  const postIds = new Set();
  state.activity.comments.forEach((comment) => postIds.add(comment.post_id));
  state.activity.shares.forEach((share) => postIds.add(share.post_id));

  if (postIds.size) {
    const postsRes = await supabase
      .from("posts")
      .select("id, title")
      .in("id", Array.from(postIds));
    const postMap = {};
    (postsRes.data || []).forEach((post) => {
      postMap[post.id] = post;
    });
    state.activity.posts = postMap;
  } else {
    state.activity.posts = {};
  }
}

async function boot() {
  setupReveal();
  const settings = await fetchSettings();
  if (settings.themeId) {
    const theme = await fetchThemeById(settings.themeId);
    if (theme) applyThemeVariables(theme);
  }

  state.user = await getCurrentUserWithRole();
  renderAuthActions();

  const paramId = getQueryParam("id");
  state.viewingId = paramId || state.user?.id || null;
  if (!state.viewingId) {
    window.location.href = "login.html?next=profile.html";
    return;
  }

  if (state.user && state.viewingId === state.user.id) {
    state.profile = await ensureProfile(state.user);
  } else {
    state.profile = await loadProfile(state.viewingId);
  }

  if (!state.profile) {
    document.getElementById("profileName").textContent = "Profile not found";
    return;
  }

  await loadFriendship();
  await loadFriendSummary();
  await loadActivity();
  await loadBookmarks();
  await loadNotifications();
  await loadAdminRequest();
  renderProfile();
  renderProfileStats();
  renderProfileAbout();
  renderVerification();
  renderProfileFriends();
  renderActivity();
  renderBookmarks();
  renderNotifications();
  setupProfileTabs();
  renderProfileActions();
  setupProfileEditor();
  setupPrivacyForm();
  setupSecurityForm();
  setupAdminRequestForm();
  setupNotificationActions();
}

async function loadBookmarks() {
  if (!state.user || state.viewingId !== state.user.id) return;
  state.bookmarks = await fetchBookmarks(state.user.id);
}

async function loadNotifications() {
  if (!state.user || state.viewingId !== state.user.id) return;
  state.notifications = await fetchNotifications(state.user.id);
}

async function loadAdminRequest() {
  if (!state.user || state.viewingId !== state.user.id) return;
  const result = await supabase
    .from("admin_requests")
    .select("*")
    .eq("user_id", state.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  state.adminRequest = result.data || null;
}

function setupAdminRequestForm() {
  const form = document.getElementById("adminRequestForm");
  const status = document.getElementById("adminRequestStatus");
  if (!form || !state.user || state.viewingId !== state.user.id) return;
  const role = state.user.user_metadata?.role || "user";
  if (role !== "user") {
    form.style.display = "none";
    if (status) status.style.display = "none";
    return;
  }

  const renderStatus = () => {
    if (!status) return;
    if (!state.adminRequest) {
      status.style.display = "none";
      return;
    }
    status.style.display = "block";
    status.textContent = `Admin request status: ${state.adminRequest.status || "pending"}.`;
  };

  renderStatus();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.adminRequest && state.adminRequest.status === "pending") {
      if (status) {
        status.textContent = "Your request is already pending review.";
        status.style.display = "block";
      }
      return;
    }
    const message = document.getElementById("adminRequestMessage").value.trim();
    const payload = {
      id: crypto.randomUUID(),
      user_id: state.user.id,
      user_email: state.user.email || "",
      user_name: state.profile?.display_name || getDisplayName(state.user),
      message,
      status: "pending",
      created_at: new Date().toISOString()
    };
    const result = await createAdminRequest(payload);
    if (status) {
      status.textContent = result.error ? "Request failed." : "Request submitted.";
      status.style.display = "block";
    }
    if (!result.error && result.data) {
      state.adminRequest = result.data;
      renderStatus();
    }
  });
}

boot().catch((error) => {
  reportAppError(error, "Profile load failed");
  const title = document.getElementById("profileName");
  if (title) title.textContent = "Error loading profile";
  const bio = document.getElementById("profileBio");
  if (bio) bio.textContent = extractErrorMessage(error, "Unable to load this profile right now.");
});
