import { supabase, getCurrentUser, getCurrentUserWithRole, getDisplayName, signOut } from "./supabase.js";
import { fetchSettings } from "./settings.js";
import { fetchThemeById, applyThemeVariables } from "./themes.js";
import {
  fetchThemes,
  toggleFollow,
  fetchFollowStatus,
  createNotification,
  incrementProfilePoints,
  fetchProfilesByUsernames,
  createContentReport
} from "./data.js";
import { uploadMedia } from "./media.js";
import {
  timeAgo,
  escapeHTML,
  clampText,
  stripHTML,
  formatRichText,
  extractMentions,
  linkifyReferences,
  isSafeUrl,
  extractErrorMessage,
  reportAppError
} from "./utils.js";
import { bindEditorToolbar } from "./editor-tools.js";
import { setupReveal } from "./reveal.js";
import "./nav.js";

const state = {
  user: null,
  themes: [],
  topics: [],
  activeTopicId: null,
  activeTopic: null,
  channel: null,
  messages: [],
  bans: [],
  bannedUsers: new Set(),
  replyTo: null,
  topicMediaFile: null,
  topicMediaPreviewUrl: "",
  isFollowingTopic: false
};

function isTopicOwner() {
  return !!(state.user && state.activeTopic && state.activeTopic.author_id === state.user.id);
}

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
    actions.appendChild(profile);
    actions.appendChild(notifications);
    actions.appendChild(chat);
    actions.appendChild(logout);
  } else {
    const login = document.createElement("a");
    login.className = "btn ghost";
    login.href = "login.html?next=discussion.html";
    login.textContent = "Log In";
    actions.appendChild(login);
  }
}

async function loadTopics() {
  const result = await supabase
    .from("discussion_topics")
    .select("*")
    .order("updated_at", { ascending: false });
  state.topics = result.data || [];
}

function renderTopics() {
  const list = document.getElementById("topicList");
  if (!list) return;
  if (!state.topics.length) {
    list.innerHTML = "<div class=\"callout\">No topics yet — start the first one.</div>";
    return;
  }
  list.innerHTML = state.topics
    .map((topic) => {
      const isActive = topic.id === state.activeTopicId;
      const mediaTag = topic.media_url ? `<span class="chip">Media</span>` : "";
      const descriptionHtml = formatRichText(topic.description || "");
      return `
        <div class="topic-item ${isActive ? "active" : ""}" data-id="${topic.id}">
          <strong>${escapeHTML(topic.title)}</strong>
          <div class="topic-meta">${escapeHTML(topic.author_name || "Member")} · ${timeAgo(
            topic.created_at
          )} ${mediaTag}</div>
          <div class="topic-desc">${descriptionHtml}</div>
        </div>
      `;
    })
    .join("");

  list.querySelectorAll(".topic-item").forEach((item) => {
    item.addEventListener("click", () => {
      selectTopic(item.dataset.id);
    });
  });
}

function updateTopicMeta() {
  const meta = document.getElementById("topicMeta");
  if (!meta) return;
  if (!state.activeTopic) {
    meta.textContent = "";
    return;
  }
  const owner = escapeHTML(state.activeTopic.author_name || "Member");
  const created = timeAgo(state.activeTopic.created_at);
  const description = state.activeTopic.description || "";
  const descriptionText = description ? clampText(stripHTML(formatRichText(description)), 120) : "";
  meta.innerHTML = `Host: ${owner} · ${created}${
    descriptionText ? ` · ${escapeHTML(descriptionText)}` : ""
  }`;
}

function updateFollowButton() {
  const btn = document.getElementById("followTopicBtn");
  if (!btn) return;
  if (!state.activeTopic || !state.user || state.activeTopic.author_id === state.user.id) {
    btn.style.display = "none";
    return;
  }
  btn.style.display = "inline-flex";
  btn.textContent = state.isFollowingTopic ? "Following" : "Follow";
}

function renderTopicMedia() {
  const target = document.getElementById("topicMedia");
  if (!target) return;
  if (!state.activeTopic || !state.activeTopic.media_url) {
    target.innerHTML = "";
    return;
  }
  const url = state.activeTopic.media_url;
  if (state.activeTopic.media_type === "video" && isSafeUrl(url)) {
    target.innerHTML = `<video controls src="${escapeHTML(url)}"></video>`;
    return;
  }
  if (isSafeUrl(url)) {
    target.innerHTML = `<img src="${escapeHTML(url)}" alt="topic media">`;
    return;
  }
  target.innerHTML = "";
}

async function selectTopic(topicId) {
  if (!topicId) return;
  state.activeTopicId = topicId;
  state.activeTopic = state.topics.find((topic) => topic.id === topicId) || null;
  state.replyTo = null;
  renderReplyPreview();
  renderTopics();
  updateTopicMeta();
  renderTopicMedia();
  if (state.user && state.activeTopicId) {
    state.isFollowingTopic = await fetchFollowStatus({
      targetType: "topic",
      targetId: state.activeTopicId,
      followerId: state.user.id
    });
  } else {
    state.isFollowingTopic = false;
  }
  updateFollowButton();

  await applyTopicTheme(state.activeTopic?.theme_id || "");
  await Promise.all([loadMessages(topicId), loadBans(topicId)]);
  updateTopicControls();
  updateMessageFormState();
  subscribeToMessages(topicId);
}

async function applyTopicTheme(themeId) {
  const shell = document.getElementById("discussionShell");
  if (!shell) return;
  if (!themeId) {
    shell.style.removeProperty("--topic-bg");
    shell.style.removeProperty("--topic-card");
    shell.style.removeProperty("--topic-ink");
    shell.style.removeProperty("--topic-muted");
    shell.style.removeProperty("--topic-wallpaper");
    return;
  }
  const theme = state.themes.find((t) => t.id === themeId) || (await fetchThemeById(themeId));
  if (!theme) return;
  shell.style.setProperty("--topic-bg", theme.bg || "");
  shell.style.setProperty("--topic-card", theme.card || "");
  shell.style.setProperty("--topic-ink", theme.ink || "");
  shell.style.setProperty("--topic-muted", theme.muted || "");
  if (theme.wallpaper_url) {
    shell.style.setProperty("--topic-wallpaper", `url("${theme.wallpaper_url}")`);
  } else {
    shell.style.removeProperty("--topic-wallpaper");
  }
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeBannedWords(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map((word) => String(word).trim()).filter(Boolean);
  }
  if (typeof raw === "string") {
    return raw
      .split(",")
      .map((word) => word.trim())
      .filter(Boolean);
  }
  return [];
}

function applyWordFilter(text, bannedWords) {
  if (!text || !bannedWords.length) return { text, hit: false };
  let updated = text;
  let hit = false;
  bannedWords.forEach((word) => {
    if (!word) return;
    const regex = new RegExp(`\\b${escapeRegExp(word)}\\b`, "gi");
    if (regex.test(updated)) {
      hit = true;
      updated = updated.replace(regex, "•••");
    }
  });
  return { text: updated, hit };
}

function renderReplyPreview() {
  const preview = document.getElementById("replyPreview");
  if (!preview) return;
  if (!state.replyTo) {
    preview.classList.add("hidden");
    preview.innerHTML = "";
    return;
  }
  const snippet = clampText(stripHTML(state.replyTo.body || ""), 90);
  preview.innerHTML = `
    <span>Replying to ${escapeHTML(state.replyTo.author_name || "Member")}: ${escapeHTML(snippet)}</span>
    <button type="button" id="cancelReply">Cancel</button>
  `;
  preview.classList.remove("hidden");
  const cancel = document.getElementById("cancelReply");
  if (cancel) {
    cancel.addEventListener("click", () => {
      state.replyTo = null;
      renderReplyPreview();
    });
  }
}

function buildMessageHtml(message) {
  const isOwner = state.activeTopic && message.author_id === state.activeTopic.author_id;
  const replyTarget = message.reply_to
    ? state.messages.find((item) => item.id === message.reply_to)
    : null;
  const replySnippet = replyTarget
    ? `<div class="callout">Replying to ${escapeHTML(
        replyTarget.author_name || "Member"
      )}: ${escapeHTML(clampText(stripHTML(replyTarget.body || ""), 90))}</div>`
    : "";
  const bodyHtml = message.body ? linkifyReferences(message.body).replace(/\n/g, "<br>") : "";
  let mediaHtml = "";
  if (message.media_url && isSafeUrl(message.media_url)) {
    const safeUrl = escapeHTML(message.media_url);
    if (message.media_type === "video") {
      mediaHtml = `<video class="message-media" controls src="${safeUrl}"></video>`;
    } else {
      mediaHtml = `<img class="message-media ${message.media_type === "sticker" ? "sticker" : ""}" src="${safeUrl}" alt="message media">`;
    }
  }
  const pinLabel = message.pinned ? " <span class=\"chip\">Pinned</span>" : "";
  const ownerLabel = isOwner ? " <span class=\"chip\">Host</span>" : "";
  const canModerate = isTopicOwner();
  const canBan = canModerate && message.author_id && message.author_id !== state.user?.id;
  const authorName = escapeHTML(message.author_name || "Member");
  const authorLink = message.author_id
    ? `<a href="profile.html?id=${encodeURIComponent(message.author_id)}">${authorName}</a>`
    : authorName;

  return `
    <div class="message-bubble ${message.pinned ? "pinned" : ""}" data-id="${
    message.id
  }">
      <div class="message-meta">
        <span>${authorLink}${ownerLabel}${pinLabel}</span>
        <span>${timeAgo(message.created_at)}</span>
      </div>
      ${replySnippet}
      ${bodyHtml ? `<div class="message-body">${bodyHtml}</div>` : ""}
      ${mediaHtml}
      <div class="message-actions">
        <button data-action="reply" data-id="${message.id}">Reply</button>
        <button data-action="report" data-id="${message.id}">Report</button>
        ${
          canModerate
            ? `<button data-action="pin" data-id="${message.id}">${
                message.pinned ? "Unpin" : "Pin"
              }</button>`
            : ""
        }
        ${
          canBan
            ? `<button class="danger" data-action="ban" data-id="${message.id}">Ban</button>`
            : ""
        }
      </div>
    </div>
  `;
}

function bindMessageActions(container) {
  if (!container) return;
  container.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const message = state.messages.find((item) => item.id === btn.dataset.id);
      if (!message) return;
      const action = btn.dataset.action;
      if (action === "reply") {
        state.replyTo = message;
        renderReplyPreview();
        const bodyInput = document.getElementById("messageBody");
        if (bodyInput) bodyInput.focus();
        return;
      }
      if (action === "report") {
        if (!state.user) {
          alert("Please log in to report.");
          return;
        }
        const reason = prompt("Why are you reporting this message?");
        if (reason === null) return;
        const result = await createContentReport({
          reporterId: state.user.id,
          contentType: "discussion_message",
          contentId: message.id,
          reason: reason.trim()
        });
        if (result?.error) {
          alert(result.error.message || "Failed to submit report.");
        } else {
          alert("Report submitted. Thank you.");
        }
        return;
      }
      if (!isTopicOwner()) return;
      if (action === "pin") {
        await supabase
          .from("discussion_messages")
          .update({
            pinned: !message.pinned,
            pinned_at: new Date().toISOString(),
            pinned_by: state.user?.id || null
          })
          .eq("id", message.id);
        await loadMessages(state.activeTopicId);
        return;
      }
      if (action === "ban") {
        await banUser(message.author_id, message.author_name || "Member");
      }
    });
  });
}

function renderPinnedMessages(messages) {
  const list = document.getElementById("pinnedList");
  if (!list) return;
  if (!messages.length) {
    list.innerHTML = "";
    return;
  }
  list.innerHTML = `
    <div class="discussion-header">Pinned</div>
    ${messages.map((message) => buildMessageHtml(message)).join("")}
  `;
  bindMessageActions(list);
}

function renderMessageList(messages) {
  const list = document.getElementById("messageList");
  if (!list) return;
  if (!messages.length) {
    list.innerHTML = "<div class=\"callout\">No messages yet — say hi first.</div>";
    return;
  }
  list.innerHTML = messages.map((message) => buildMessageHtml(message)).join("");
  bindMessageActions(list);
  list.scrollTop = list.scrollHeight;
}

async function loadMessages(topicId) {
  const list = document.getElementById("messageList");
  if (!list) return;
  const result = await supabase
    .from("discussion_messages")
    .select("*")
    .eq("topic_id", topicId)
    .order("created_at", { ascending: true });
  state.messages = result.data || [];
  const pinned = state.messages.filter((message) => message.pinned);
  const regular = state.messages.filter((message) => !message.pinned);
  renderPinnedMessages(pinned);
  renderMessageList(regular);
}

function subscribeToMessages(topicId) {
  if (state.channel) {
    supabase.removeChannel(state.channel);
  }
  state.channel = supabase
    .channel(`topic-${topicId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "discussion_messages",
        filter: `topic_id=eq.${topicId}`
      },
      async () => {
        await loadMessages(topicId);
      }
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "discussion_messages",
        filter: `topic_id=eq.${topicId}`
      },
      async () => {
        await loadMessages(topicId);
      }
    )
    .subscribe();
}

async function loadBans(topicId) {
  const result = await supabase
    .from("discussion_bans")
    .select("*")
    .eq("topic_id", topicId)
    .order("created_at", { ascending: false });
  state.bans = result.data || [];
  state.bannedUsers = new Set(state.bans.map((ban) => ban.user_id));
  renderBannedUsers();
}

function renderBannedUsers() {
  const list = document.getElementById("bannedUsersList");
  if (!list) return;
  if (!isTopicOwner()) {
    list.innerHTML = "";
    return;
  }
  if (!state.bans.length) {
    list.innerHTML = "<div class=\"callout\">No banned members.</div>";
    return;
  }
  list.innerHTML = state.bans
    .map(
      (ban) => `
      <div class="topic-item" data-id="${ban.id}">
        <strong>${escapeHTML(ban.user_name || "Member")}</strong>
        <div class="topic-meta">Banned ${timeAgo(ban.created_at)}</div>
        <button class="btn ghost" data-action="unban" data-id="${ban.id}">Unban</button>
      </div>
    `
    )
    .join("");

  list.querySelectorAll("button[data-action='unban']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await supabase.from("discussion_bans").delete().eq("id", btn.dataset.id);
      await loadBans(state.activeTopicId);
      updateMessageFormState();
    });
  });
}

function updateMessageFormState() {
  const status = document.getElementById("messageStatus");
  const form = document.getElementById("messageForm");
  if (!form) return;
  const textarea = document.getElementById("messageBody");
  const submit = form.querySelector("button");
  if (!state.activeTopicId) {
    if (textarea) textarea.disabled = true;
    if (submit) submit.disabled = true;
    if (status) {
      status.textContent = "Select a topic to start chatting.";
      status.style.display = "block";
    }
    return;
  }
  if (state.user && state.bannedUsers.has(state.user.id)) {
    if (textarea) textarea.disabled = true;
    if (submit) submit.disabled = true;
    if (status) {
      status.textContent = "You have been banned from this topic.";
      status.style.display = "block";
    }
    return;
  }
  if (textarea) textarea.disabled = false;
  if (submit) submit.disabled = false;
  if (status) {
    status.style.display = "none";
  }
}

async function banUser(userId, userName) {
  if (!state.activeTopicId || !userId) return;
  if (state.bannedUsers.has(userId)) return;
  const result = await supabase.from("discussion_bans").insert({
    id: crypto.randomUUID(),
    topic_id: state.activeTopicId,
    user_id: userId,
    user_name: userName,
    banned_by: state.user?.id || null,
    reason: "",
    created_at: new Date().toISOString()
  });
  if (result.error) {
    const status = document.getElementById("messageStatus");
    if (status) {
      status.textContent = result.error.message || "Ban failed.";
      status.style.display = "block";
    }
    return;
  }
  await loadBans(state.activeTopicId);
  updateMessageFormState();
}

function setupTopicControls() {
  const saveBtn = document.getElementById("saveTopicRules");
  if (!saveBtn || saveBtn.dataset.bound) return;
  saveBtn.dataset.bound = "true";
  saveBtn.addEventListener("click", async () => {
    if (!isTopicOwner()) return;
    const mode = document.getElementById("topicModerationMode").value || "off";
    const bannedWordsRaw = document.getElementById("topicBannedWords").value || "";
    const bannedWords = normalizeBannedWords(bannedWordsRaw);
    const result = await supabase
      .from("discussion_topics")
      .update({
        moderation_mode: mode,
        banned_words: bannedWords,
        updated_at: new Date().toISOString()
      })
      .eq("id", state.activeTopicId)
      .select()
      .single();
    const status = document.getElementById("topicRulesStatus");
    if (status) {
      status.textContent = result.error ? "Rules update failed." : "Rules updated.";
      status.style.display = "block";
    }
    if (!result.error && result.data) {
      state.activeTopic = result.data;
      const index = state.topics.findIndex((topic) => topic.id === result.data.id);
      if (index !== -1) state.topics[index] = result.data;
      updateTopicControls();
    }
  });
}

function updateTopicControls() {
  const controls = document.getElementById("topicControls");
  if (!controls) return;
  if (!isTopicOwner()) {
    controls.style.display = "none";
    return;
  }
  controls.style.display = "block";
  const modeSelect = document.getElementById("topicModerationMode");
  const bannedInput = document.getElementById("topicBannedWords");
  if (modeSelect) {
    modeSelect.value = state.activeTopic?.moderation_mode || "off";
  }
  if (bannedInput) {
    const bannedWords = normalizeBannedWords(state.activeTopic?.banned_words);
    bannedInput.value = bannedWords.join(", ");
  }
  renderBannedUsers();
}

function setupFollowButton() {
  const btn = document.getElementById("followTopicBtn");
  if (!btn || btn.dataset.bound) return;
  btn.dataset.bound = "true";
  btn.addEventListener("click", async () => {
    if (!state.user) {
      window.location.href = "login.html?next=discussion.html";
      return;
    }
    if (!state.activeTopicId) return;
    const result = await toggleFollow({
      targetType: "topic",
      targetId: state.activeTopicId,
      followerId: state.user.id
    });
    state.isFollowingTopic = result.following;
    updateFollowButton();
    if (result.following && state.activeTopic?.author_id && state.activeTopic.author_id !== state.user.id) {
      const authorPref = await supabase
        .from("profiles")
        .select("notify_follows")
        .eq("id", state.activeTopic.author_id)
        .maybeSingle();
      if (authorPref.data?.notify_follows === false) return;
      await createNotification({
        userId: state.activeTopic.author_id,
        type: "topic_follow",
        title: "New topic follower",
        body: `${getDisplayName(state.user)} followed your topic "${state.activeTopic.title}".`,
        linkUrl: `discussion.html?topic=${state.activeTopicId}`
      });
    }
  });
}

function setupTopicForm() {
  const form = document.getElementById("topicForm");
  const status = document.getElementById("topicStatus");
  const themeSelect = document.getElementById("topicThemeSelect");
  const mediaInput = document.getElementById("topicMediaFile");
  const mediaPreview = document.getElementById("topicMediaPreview");
  if (!form) return;
  if (!state.user) {
    form.querySelector("button").textContent = "Log in to create topic";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      window.location.href = "login.html?next=discussion.html";
    });
    return;
  }

  if (themeSelect) {
    themeSelect.innerHTML = `
      <option value="">Default theme</option>
      ${state.themes.map((theme) => `<option value="${theme.id}">${theme.name}</option>`).join("")}
    `;
  }

  if (mediaInput) {
    mediaInput.addEventListener("change", () => {
      const file = mediaInput.files[0];
      if (!file) {
        state.topicMediaFile = null;
        if (state.topicMediaPreviewUrl) {
          URL.revokeObjectURL(state.topicMediaPreviewUrl);
        }
        state.topicMediaPreviewUrl = "";
        if (mediaPreview) {
          mediaPreview.innerHTML = "Topic media preview (optional)";
        }
        return;
      }
      state.topicMediaFile = file;
      if (state.topicMediaPreviewUrl) {
        URL.revokeObjectURL(state.topicMediaPreviewUrl);
      }
      state.topicMediaPreviewUrl = URL.createObjectURL(file);
      if (mediaPreview) {
        const isVideo = file.type?.startsWith("video");
        mediaPreview.innerHTML = isVideo
          ? `<video controls src="${state.topicMediaPreviewUrl}"></video>`
          : `<img src="${state.topicMediaPreviewUrl}" alt="topic preview">`;
      }
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = document.getElementById("topicTitle").value.trim();
    const description = document.getElementById("topicDescription").value.trim();
    const themeId = themeSelect?.value || "";
    if (!title || !description) return;

    let mediaUrl = "";
    let mediaType = "";
    if (state.topicMediaFile) {
      mediaUrl = await uploadMedia(state.topicMediaFile, "topics");
      if (mediaUrl) {
        mediaType = state.topicMediaFile.type?.startsWith("video") ? "video" : "image";
      }
    }

    const payload = {
      id: crypto.randomUUID(),
      title,
      description,
      theme_id: themeId || null,
      author_id: state.user.id,
      author_name: getDisplayName(state.user),
      media_url: mediaUrl || null,
      media_type: mediaType || null,
      moderation_mode: "off",
      banned_words: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const result = await supabase.from("discussion_topics").insert(payload);
    if (result.error) {
      if (status) {
        status.textContent = result.error.message || "Topic creation failed.";
        status.style.display = "block";
      }
      return;
    }
    form.reset();
    state.topicMediaFile = null;
    if (state.topicMediaPreviewUrl) {
      URL.revokeObjectURL(state.topicMediaPreviewUrl);
      state.topicMediaPreviewUrl = "";
    }
    if (mediaPreview) {
      mediaPreview.innerHTML = "Topic media preview (optional)";
    }
    if (status) {
      status.textContent = "Topic created.";
      status.style.display = "block";
    }
    if (state.user) {
      await incrementProfilePoints(state.user.id, 5);
    }
    await loadTopics();
    renderTopics();
  });
}

function setupMessageForm() {
  const form = document.getElementById("messageForm");
  const status = document.getElementById("messageStatus");
  const mediaInput = document.getElementById("messageMedia");
  const mediaType = document.getElementById("messageMediaType");
  const preview = document.getElementById("messageMediaPreview");
  let mediaFile = null;
  let previewUrl = "";

  if (!form) return;
  if (!state.user) {
    form.querySelector("button").textContent = "Log in to chat";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      window.location.href = "login.html?next=discussion.html";
    });
    return;
  }

  if (mediaInput) {
    mediaInput.addEventListener("change", () => {
      const file = mediaInput.files[0];
      if (!file) {
        mediaFile = null;
        previewUrl = "";
        if (preview) preview.innerHTML = "";
        if (mediaType) {
          mediaType.disabled = false;
          mediaType.value = "image";
        }
        return;
      }
      mediaFile = file;
      if (preview) {
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        previewUrl = URL.createObjectURL(file);
        const isVideo = file.type?.startsWith("video");
        preview.innerHTML = isVideo
          ? `<video controls src="${previewUrl}"></video>`
          : `<img src="${previewUrl}" alt="preview">`;
        if (mediaType) {
          if (isVideo) {
            mediaType.value = "video";
            mediaType.disabled = true;
          } else {
            if (mediaType.value === "video") {
              mediaType.value = "image";
            }
            mediaType.disabled = false;
          }
        }
      }
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const bodyInput = document.getElementById("messageBody");
    const rawBody = bodyInput.value.trim();
    if (!state.activeTopicId) {
      if (status) {
        status.textContent = "Select a topic first.";
        status.style.display = "block";
      }
      return;
    }
    if (state.bannedUsers.has(state.user.id)) {
      if (status) {
        status.textContent = "You are banned from this topic.";
        status.style.display = "block";
      }
      return;
    }
    if (!rawBody && !mediaFile) {
      if (status) {
        status.textContent = "Write a message or attach media.";
        status.style.display = "block";
      }
      return;
    }

    const bannedWords = normalizeBannedWords(state.activeTopic?.banned_words);
    const moderationMode = state.activeTopic?.moderation_mode || "off";
    const filtered = applyWordFilter(rawBody, bannedWords);
    if (moderationMode === "block" && filtered.hit) {
      if (status) {
        status.textContent = "Your message contains banned words.";
        status.style.display = "block";
      }
      return;
    }
    const finalBody = moderationMode === "mask" ? filtered.text : rawBody;

    let mediaUrl = "";
    let mediaKind = "";
    if (mediaFile) {
      mediaUrl = await uploadMedia(mediaFile, "discussion");
      if (!mediaUrl) {
        if (status) {
          status.textContent = "Upload failed. Try again.";
          status.style.display = "block";
        }
        return;
      }
      const isVideo = mediaFile.type?.startsWith("video");
      if (isVideo) {
        mediaKind = "video";
      } else {
        mediaKind = mediaType?.value === "sticker" ? "sticker" : "image";
      }
    }

    const payload = {
      id: crypto.randomUUID(),
      topic_id: state.activeTopicId,
      author_id: state.user.id,
      author_name: getDisplayName(state.user),
      body: finalBody,
      media_url: mediaUrl,
      media_type: mediaKind,
      reply_to: state.replyTo?.id || null,
      pinned: false,
      created_at: new Date().toISOString()
    };
    const result = await supabase.from("discussion_messages").insert(payload);
    if (result.error) {
      if (status) {
        status.textContent = result.error.message || "Message failed.";
        status.style.display = "block";
      }
      return;
    }
      const mentionHandles = extractMentions(finalBody || "");
      if (mentionHandles.length) {
        const mentioned = await fetchProfilesByUsernames(mentionHandles);
        const link = `discussion.html?topic=${state.activeTopicId}`;
        await Promise.all(
          mentioned
            .filter((profile) => profile.id && profile.id !== state.user.id && profile.notify_mentions !== false)
            .map((profile) =>
              createNotification({
                userId: profile.id,
                type: "mention",
                title: "You were mentioned",
                body: `${getDisplayName(state.user)} mentioned you in "${state.activeTopic?.title || "a topic"}".`,
                linkUrl: link
              })
            )
        );
      }
    if (state.replyTo?.author_id && state.replyTo.author_id !== state.user.id) {
      await createNotification({
        userId: state.replyTo.author_id,
        type: "reply",
        title: "New reply",
        body: `${getDisplayName(state.user)} replied to your message.`,
        linkUrl: `discussion.html?topic=${state.activeTopicId}`
      });
    }
    await supabase
      .from("discussion_topics")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", state.activeTopicId);
    form.reset();
    state.replyTo = null;
    renderReplyPreview();
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
      previewUrl = "";
    }
    if (preview) {
      preview.innerHTML = "";
    }
    if (mediaType) {
      mediaType.disabled = false;
      mediaType.value = "image";
    }
    mediaFile = null;
    if (state.user) {
      await incrementProfilePoints(state.user.id, 1);
    }
  });
}

async function boot() {
  setupReveal();
  state.user = await getCurrentUserWithRole();
  renderAuthActions();

  const settings = await fetchSettings();
  if (settings.themeId) {
    const theme = await fetchThemeById(settings.themeId);
    if (theme) applyThemeVariables(theme);
  }

  state.themes = await fetchThemes();
  await loadTopics();
  renderTopics();
  bindEditorToolbar("topicToolbar", "topicDescription");
  const params = new URLSearchParams(window.location.search);
  const topicId = params.get("topic");
  if (topicId) {
    await selectTopic(topicId);
  }
  setupTopicForm();
  setupMessageForm();
  setupTopicControls();
  setupFollowButton();
  updateMessageFormState();
}

boot().catch((error) => {
  reportAppError(error, "Discussion load failed");
  const message = extractErrorMessage(error, "Unable to load discussion right now.");
  const topicList = document.getElementById("topicList");
  if (topicList) {
    topicList.innerHTML = `<div class="callout">${escapeHTML(message)}</div>`;
  }
  const messageList = document.getElementById("messageList");
  if (messageList) {
    messageList.innerHTML = `<div class="callout">${escapeHTML(message)}</div>`;
  }
});
