import { supabase, getCurrentUser, getDisplayName, signOut } from "./supabase.js";
import { createContentReport } from "./data.js";
import { formatRichText, sanitizeHTML, escapeHTML, isSafeUrl } from "./utils.js";

const params = new URLSearchParams(window.location.search);
const novelId = params.get("id");

const uuid = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

const notify = (message, tone = "info", title = null) => {
  if (window.appUI?.toast) {
    window.appUI.toast(message, {
      tone,
      title: title || (tone === "error" ? "Novel Error" : "Novel")
    });
    return;
  }
  if (tone === "error") console.error(message);
  else console.log(message);
};

const askForText = async (message, options = {}) => {
  if (window.appUI?.prompt) {
    return window.appUI.prompt(message, options);
  }
  return window.prompt(message);
};

const state = {
  user: null,
  novel: null,
  chapters: [],
  currentChapterIndex: -1,
  currentChapterId: null,
  isAuthor: false,
  hasLiked: false,
  likeCount: 0,
  isSubscribed: false,
  commentsAvailable: null
};

function setupAuth() {
  const authActions = document.getElementById("authActions");
  const commentForm = document.getElementById("commentForm");
  if (!authActions) return;

  if (state.user) {
    authActions.innerHTML = `
      <span class="auth-meta">${escapeHTML(getDisplayName(state.user))}</span>
      <a class="btn ghost" href="profile.html">Profile</a>
      <button class="btn ghost" id="logoutBtn">Log Out</button>
    `;
    document.getElementById("logoutBtn")?.addEventListener("click", async () => {
      await signOut();
      window.location.reload();
    });
    if (commentForm) commentForm.style.display = "block";
  } else {
    authActions.innerHTML = `<a class="btn ghost" href="login.html?next=novel.html%3Fid%3D${encodeURIComponent(novelId)}">Log In</a>`;
    if (commentForm) commentForm.style.display = "none";
  }
}

function setContentError(message) {
  document.getElementById("contentSection").innerHTML = `
    <div class="callout" style="margin-top:20px; border-left-color:#ef4444;">
      ${escapeHTML(message)}
    </div>
  `;
}

async function loadNovel() {
  try {
    const result = await supabase
      .from("novels")
      .select("*")
      .eq("id", novelId)
      .single();
    if (result.error || !result.data) {
      throw new Error(result.error?.message || "Novel not found.");
    }

    state.novel = result.data;
    state.isAuthor = state.user?.id === state.novel.author_id;

    document.getElementById("novelTitle").textContent = state.novel.title || "Untitled";
    document.getElementById("authorName").textContent = state.novel.author_name || "Unknown author";
    document.getElementById("chapterCount").textContent = String(state.novel.chapters_count || 0);
    document.getElementById("viewCount").textContent = String(state.novel.views || 0);
    document.getElementById("likeCount").textContent = String(state.novel.likes || 0);
    document.getElementById("statusBadge").textContent = state.novel.status || "ongoing";
    document.getElementById("synopsis").textContent = state.novel.synopsis || "No synopsis available.";

    if (state.novel.cover_url && isSafeUrl(state.novel.cover_url)) {
      document.getElementById("coverImg").innerHTML = `<img src="${escapeHTML(state.novel.cover_url)}" alt="${escapeHTML(state.novel.title || "Cover")}">`;
    } else {
      document.getElementById("coverImg").textContent = "📖";
    }

    document.getElementById("editBtn").style.display = state.isAuthor ? "flex" : "none";
    document.getElementById("chapterFormSection").style.display = state.isAuthor ? "block" : "none";
  } catch (error) {
    console.error("Novel load error:", error);
    notify(error?.message || "Failed to load novel.", "error");
    setContentError(error?.message || "Novel not found.");
  }
}

async function loadChapters() {
  try {
    const result = await supabase
      .from("chapters")
      .select("*")
      .eq("novel_id", novelId)
      .order("chapter_number", { ascending: true });
    if (result.error) throw result.error;

    state.chapters = result.data || [];
    document.getElementById("chapterCount").textContent = String(state.chapters.length || state.novel?.chapters_count || 0);
    renderChaptersList();
  } catch (error) {
    console.error("Chapter load error:", error);
    notify(error?.message || "Failed to load chapters.", "error");
  }
}

async function refreshEngagementState() {
  try {
    const likeCountResult = await supabase
      .from("novel_likes")
      .select("id", { count: "exact", head: true })
      .eq("novel_id", novelId);

    if (!likeCountResult.error) {
      state.likeCount = likeCountResult.count || 0;
    } else {
      state.likeCount = Number(state.novel?.likes || 0);
    }

    if (state.user) {
      const likedResult = await supabase
        .from("novel_likes")
        .select("id")
        .eq("novel_id", novelId)
        .eq("user_id", state.user.id)
        .maybeSingle();
      state.hasLiked = !!likedResult.data;

      const subResult = await supabase
        .from("novel_subscriptions")
        .select("id")
        .eq("novel_id", novelId)
        .eq("user_id", state.user.id)
        .maybeSingle();
      state.isSubscribed = !!subResult.data;
    } else {
      state.hasLiked = false;
      state.isSubscribed = false;
    }
  } catch (error) {
    console.warn("Engagement state warning:", error);
  }
  renderEngagementButtons();
}

function renderEngagementButtons() {
  const likeBtn = document.getElementById("likeBtn");
  const subscribeBtn = document.getElementById("subscribeBtn");
  const likeCount = document.getElementById("likeCount");

  if (likeCount) likeCount.textContent = String(state.likeCount || 0);

  if (likeBtn) {
    likeBtn.classList.toggle("active", !!state.hasLiked);
    likeBtn.textContent = state.hasLiked ? "❤️ Liked" : "❤️ Like";
  }

  if (subscribeBtn) {
    subscribeBtn.classList.toggle("active", !!state.isSubscribed);
    subscribeBtn.textContent = state.isSubscribed ? "🔕 Subscribed" : "🔔 Subscribe";
  }
}

function renderChaptersList() {
  const list = document.getElementById("chaptersList");
  if (!list) return;

  if (!state.chapters.length) {
    list.innerHTML = `<div style="padding: 16px; text-align: center; color: #999;">${state.isAuthor ? "No chapters yet. Create one!" : "No chapters published yet."}</div>`;
    return;
  }

  list.innerHTML = state.chapters.map((chapter, index) => `
    <div class="chapter-item" data-idx="${index}">
      <div>
        <div class="chapter-title">Chapter ${escapeHTML(String(chapter.chapter_number || ""))}: ${escapeHTML(chapter.title || "")}</div>
        <div class="chapter-published">${escapeHTML(new Date(chapter.created_at).toLocaleDateString())}</div>
      </div>
      <div style="text-align: right; color: #999; font-size: 12px;">${escapeHTML(String(chapter.word_count || 0))} words</div>
    </div>
  `).join("");

  list.querySelectorAll(".chapter-item").forEach((item) => {
    item.addEventListener("click", () => {
      const idx = Number.parseInt(item.dataset.idx, 10);
      if (Number.isFinite(idx)) {
        readChapter(idx);
      }
    });
  });
}

async function ensureNovelCommentsAvailable() {
  if (state.commentsAvailable !== null) return state.commentsAvailable;
  const probe = await supabase.from("novel_comments").select("id").limit(1);
  if (probe.error) {
    state.commentsAvailable = false;
    const commentsList = document.getElementById("commentsList");
    if (commentsList) {
      commentsList.innerHTML = `
        <div class="callout" style="border-left-color:#ef4444;">
          Comments are unavailable: ${escapeHTML(probe.error.message || "novel_comments table not ready.")}
        </div>
      `;
    }
    document.getElementById("commentForm").style.display = "none";
    return false;
  }
  state.commentsAvailable = true;
  if (state.user) document.getElementById("commentForm").style.display = "block";
  return true;
}

async function loadChapterComments(chapterId) {
  const list = document.getElementById("commentsList");
  if (!list) return;
  list.innerHTML = `<div class="hint">Loading comments...</div>`;

  if (!(await ensureNovelCommentsAvailable())) return;
  if (!chapterId) {
    list.innerHTML = `<div class="hint">Open a chapter to view comments.</div>`;
    return;
  }

  const result = await supabase
    .from("novel_comments")
    .select("id, user_id, author_name, body, created_at")
    .eq("chapter_id", chapterId)
    .order("created_at", { ascending: false });

  if (result.error) {
    list.innerHTML = `<div class="callout" style="border-left-color:#ef4444;">${escapeHTML(result.error.message)}</div>`;
    return;
  }

  const comments = result.data || [];
  if (!comments.length) {
    list.innerHTML = `<div class="hint">No comments yet for this chapter.</div>`;
    return;
  }

  list.innerHTML = comments.map((comment) => `
    <article class="comment-form" style="background:#fff; margin-top:8px;">
      <div style="display:flex; justify-content:space-between; gap:12px; margin-bottom:8px;">
        <strong>${escapeHTML(comment.author_name || "Reader")}</strong>
        <span class="hint">${escapeHTML(new Date(comment.created_at).toLocaleString())}</span>
      </div>
      <div style="line-height:1.6;">${sanitizeHTML(formatRichText(comment.body || ""))}</div>
    </article>
  `).join("");
}

function readChapter(index) {
  state.currentChapterIndex = index;
  const chapter = state.chapters[index];
  if (!chapter) return;
  state.currentChapterId = chapter.id;

  document.getElementById("chaptersView").style.display = "none";
  document.getElementById("readerView").style.display = "block";
  document.getElementById("readerContent").innerHTML = `
    <h2>Chapter ${escapeHTML(String(chapter.chapter_number || ""))}: ${escapeHTML(chapter.title || "")}</h2>
    <div style="color: #999; font-size: 14px; margin-bottom: 20px;">
      ${escapeHTML(new Date(chapter.created_at).toLocaleDateString())} • ${escapeHTML(String(chapter.word_count || 0))} words
    </div>
    <div>${sanitizeHTML(formatRichText(chapter.content || ""))}</div>
  `;

  const atFirst = index === 0;
  const atLast = index >= state.chapters.length - 1;
  ["prevBtn", "prevBtn2"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = atFirst;
  });
  ["nextBtn", "nextBtn2"].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.disabled = atLast;
  });

  loadChapterComments(chapter.id);
  window.scrollTo(0, 0);
}

function bindChapterNavigation(buttonId, delta) {
  document.getElementById(buttonId)?.addEventListener("click", () => {
    const next = state.currentChapterIndex + delta;
    if (next < 0 || next >= state.chapters.length) return;
    readChapter(next);
  });
}

function setupEventListeners() {
  document.getElementById("likeBtn")?.addEventListener("click", async () => {
    if (!state.user) {
      window.location.href = `login.html?next=novel.html%3Fid%3D${encodeURIComponent(novelId)}`;
      return;
    }
    const likeBtn = document.getElementById("likeBtn");
    if (likeBtn) likeBtn.disabled = true;

    try {
      const previouslyLiked = state.hasLiked;
      if (previouslyLiked) {
        const remove = await supabase
          .from("novel_likes")
          .delete()
          .eq("novel_id", novelId)
          .eq("user_id", state.user.id);
        if (remove.error) throw remove.error;
      } else {
        const add = await supabase.from("novel_likes").insert({
          id: uuid(),
          user_id: state.user.id,
          novel_id: novelId,
          created_at: new Date().toISOString()
        });
        if (add.error) throw add.error;
      }
      await refreshEngagementState();
      notify(previouslyLiked ? "Like removed." : "Thanks for liking this novel.", "success");
    } catch (error) {
      notify(error?.message || "Failed to update like.", "error");
    } finally {
      if (likeBtn) likeBtn.disabled = false;
    }
  });

  document.getElementById("subscribeBtn")?.addEventListener("click", async () => {
    if (!state.user) {
      window.location.href = `login.html?next=novel.html%3Fid%3D${encodeURIComponent(novelId)}`;
      return;
    }
    const subscribeBtn = document.getElementById("subscribeBtn");
    if (subscribeBtn) subscribeBtn.disabled = true;

    try {
      const wasSubscribed = state.isSubscribed;
      if (wasSubscribed) {
        const remove = await supabase
          .from("novel_subscriptions")
          .delete()
          .eq("novel_id", novelId)
          .eq("user_id", state.user.id);
        if (remove.error) throw remove.error;
      } else {
        const add = await supabase.from("novel_subscriptions").insert({
          id: uuid(),
          user_id: state.user.id,
          novel_id: novelId,
          created_at: new Date().toISOString()
        });
        if (add.error) throw add.error;
      }
      await refreshEngagementState();
      notify(wasSubscribed ? "Subscription removed." : "Subscribed. You will see updates in your account feeds.", "success");
    } catch (error) {
      notify(error?.message || "Failed to update subscription.", "error");
    } finally {
      if (subscribeBtn) subscribeBtn.disabled = false;
    }
  });

  document.getElementById("shareBtn")?.addEventListener("click", async () => {
    const shareUrl = `${window.location.origin}/novel.html?id=${encodeURIComponent(novelId)}`;
    const payload = {
      title: state.novel?.title || "Novel",
      text: state.novel?.synopsis || "Check out this novel on Timzee Tech Hub.",
      url: shareUrl
    };
    try {
      if (navigator.share) {
        await navigator.share(payload);
        return;
      }
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        notify("Link copied to clipboard.", "success");
        return;
      }
      notify(shareUrl, "info", "Copy this link");
    } catch (error) {
      notify(error?.message || "Failed to share this novel.", "error");
    }
  });

  document.getElementById("reportNovelBtn")?.addEventListener("click", async () => {
    if (!state.user) {
      window.location.href = `login.html?next=novel.html%3Fid%3D${encodeURIComponent(novelId)}`;
      return;
    }
    const reason = await askForText("Why are you reporting this novel?", {
      title: "Report Novel",
      placeholder: "Describe the issue...",
      confirmText: "Submit",
      cancelText: "Cancel"
    });
    if (reason === null) return;
    if (!String(reason || "").trim()) {
      notify("Report reason is required.", "warning");
      return;
    }

    const result = await createContentReport({
      reporterId: state.user.id,
      contentType: "novel",
      contentId: novelId,
      reason: String(reason).trim()
    });
    if (result?.error) {
      notify(result.error.message || "Failed to submit report.", "error");
    } else {
      notify("Report submitted. Thank you.", "success");
    }
  });

  document.getElementById("editBtn")?.addEventListener("click", () => {
    if (!state.isAuthor || !state.novel) return;
    document.getElementById("editTitle").value = state.novel.title || "";
    document.getElementById("editSynopsis").value = state.novel.synopsis || "";
    document.getElementById("editStatus").value = state.novel.status || "ongoing";
    document.getElementById("editModal").classList.add("active");
  });

  const closeEditModal = () => document.getElementById("editModal").classList.remove("active");
  document.getElementById("closeModal")?.addEventListener("click", closeEditModal);
  document.getElementById("closeEditBtn")?.addEventListener("click", closeEditModal);
  document.getElementById("editModal")?.addEventListener("click", (event) => {
    if (event.target.id === "editModal") closeEditModal();
  });

  document.getElementById("editForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const result = await supabase
      .from("novels")
      .update({
        title: document.getElementById("editTitle").value.trim(),
        synopsis: document.getElementById("editSynopsis").value.trim(),
        status: document.getElementById("editStatus").value,
        updated_at: new Date().toISOString()
      })
      .eq("id", novelId);

    if (result.error) {
      notify(result.error.message || "Failed to save novel changes.", "error");
      return;
    }
    closeEditModal();
    notify("Novel updated.", "success");
    await loadNovel();
  });

  document.getElementById("chapterForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.isAuthor) return;

    const status = document.getElementById("chapterStatus");
    const submitBtn = document.querySelector("#chapterForm button[type='submit']");
    if (!status || !submitBtn) return;

    submitBtn.disabled = true;
    status.style.display = "block";
    status.textContent = "Publishing...";
    status.style.color = "#0f766e";

    try {
      const content = document.getElementById("chapterContent").value;
      const chapter = {
        id: uuid(),
        novel_id: novelId,
        chapter_number: state.chapters.length + 1,
        title: document.getElementById("chapterTitle").value.trim(),
        content,
        word_count: content.trim().split(/\s+/).filter(Boolean).length,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };

      const insertResult = await supabase.from("chapters").insert(chapter);
      if (insertResult.error) throw insertResult.error;

      await supabase
        .from("novels")
        .update({
          chapters_count: (state.novel?.chapters_count || 0) + 1,
          updated_at: new Date().toISOString()
        })
        .eq("id", novelId);

      status.textContent = "Chapter published.";
      status.style.color = "#047857";
      notify("Chapter published successfully.", "success");
      document.getElementById("chapterForm").reset();
      document.getElementById("charCount").textContent = "0";
      await loadNovel();
      await loadChapters();
    } catch (error) {
      status.textContent = `Error: ${error.message || "Failed to publish chapter."}`;
      status.style.color = "#b91c1c";
      notify(error?.message || "Failed to publish chapter.", "error");
    } finally {
      submitBtn.disabled = false;
    }
  });

  document.getElementById("cancelChapter")?.addEventListener("click", () => {
    document.getElementById("chapterForm")?.reset();
    document.getElementById("charCount").textContent = "0";
  });

  document.getElementById("chapterContent")?.addEventListener("input", (event) => {
    document.getElementById("charCount").textContent = String(event.target.value.length);
  });

  document.getElementById("commentForm")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.user) {
      window.location.href = `login.html?next=novel.html%3Fid%3D${encodeURIComponent(novelId)}`;
      return;
    }
    if (!state.currentChapterId) {
      notify("Open a chapter first before commenting.", "warning");
      return;
    }
    if (!(await ensureNovelCommentsAvailable())) {
      notify("Novel comments are not available yet.", "error");
      return;
    }

    const body = document.getElementById("commentBody").value.trim();
    if (!body) {
      notify("Comment cannot be empty.", "warning");
      return;
    }

    const status = document.getElementById("commentStatus");
    if (status) {
      status.style.display = "block";
      status.style.color = "#0f766e";
      status.textContent = "Posting comment...";
    }

    try {
      const insertResult = await supabase.from("novel_comments").insert({
        id: uuid(),
        novel_id: novelId,
        chapter_id: state.currentChapterId,
        user_id: state.user.id,
        author_name: getDisplayName(state.user),
        body,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      });
      if (insertResult.error) throw insertResult.error;

      document.getElementById("commentBody").value = "";
      if (status) {
        status.style.color = "#047857";
        status.textContent = "Comment posted.";
      }
      await loadChapterComments(state.currentChapterId);
    } catch (error) {
      if (status) {
        status.style.color = "#b91c1c";
        status.textContent = `Error: ${error.message || "Failed to post comment."}`;
      }
      notify(error?.message || "Failed to post comment.", "error");
    }
  });

  bindChapterNavigation("prevBtn", -1);
  bindChapterNavigation("prevBtn2", -1);
  bindChapterNavigation("nextBtn", 1);
  bindChapterNavigation("nextBtn2", 1);

  document.getElementById("backToChapters")?.addEventListener("click", (event) => {
    event.preventDefault();
    document.getElementById("chaptersView").style.display = "block";
    document.getElementById("readerView").style.display = "none";
  });
}

async function init() {
  if (!novelId) {
    window.location.href = "novels.html";
    return;
  }

  state.user = await getCurrentUser();
  setupAuth();
  await loadNovel();
  await loadChapters();
  await refreshEngagementState();
  setupEventListeners();
}

init();
