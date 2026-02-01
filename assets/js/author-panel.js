import { supabase, getCurrentUserWithRole, getUserRole, signOut, getDisplayName } from "./supabase.js";
import { escapeHTML } from "./utils.js";

const state = {
  user: null,
  novels: []
};

function setupTabs() {
  const tabBtns = document.querySelectorAll(".admin-nav button");
  const tabContents = document.querySelectorAll(".admin-card");
  tabBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab;
      const targetPanel = document.querySelector(`[data-panel="${tab}"]`);
      if (!targetPanel) return;
      tabBtns.forEach((b) => b.classList.remove("active"));
      tabContents.forEach((c) => (c.style.display = "none"));
      btn.classList.add("active");
      targetPanel.style.display = "block";
    });
  });
}

function setStatus(elementId, message, isError = false) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.style.display = "block";
  el.style.color = isError ? "#ef4444" : "#16a34a";
  el.textContent = message;
}

async function loadNovels() {
  const result = await supabase
    .from("novels")
    .select("id, title, status, created_at")
    .eq("author_id", state.user.id)
    .order("created_at", { ascending: false });
  if (result.error) {
    document.getElementById("authorNovels").textContent = result.error.message;
    return;
  }
  state.novels = result.data || [];
  const cards = state.novels.map(
    (novel) => `
      <div class="form-card" style="margin-bottom:12px;">
        <strong>${escapeHTML(novel.title || "Untitled")}</strong>
        <div style="color:#666;font-size:12px;">Status: ${escapeHTML(novel.status || "ongoing")}</div>
        <div class="inline-actions" style="margin-top:8px;">
          <button class="btn ghost" data-action="delete-novel" data-id="${novel.id}">Delete</button>
        </div>
      </div>`
  );
  document.getElementById("authorNovels").innerHTML = cards.join("") || "<div class='callout'>No novels yet.</div>";
  const select = document.getElementById("chapterNovel");
  select.innerHTML = state.novels.map((novel) => `<option value="${novel.id}">${escapeHTML(novel.title)}</option>`).join("");
}

async function loadChapters(novelId) {
  if (!novelId) return;
  const result = await supabase
    .from("chapters")
    .select("id, chapter_number, title, created_at")
    .eq("novel_id", novelId)
    .order("chapter_number", { ascending: true });
  if (result.error) {
    document.getElementById("authorChapters").textContent = result.error.message;
    return;
  }
  const cards = (result.data || []).map(
    (chapter) => `
      <div class="form-card" style="margin-bottom:12px;">
        <strong>Chapter ${chapter.chapter_number}: ${escapeHTML(chapter.title || "")}</strong>
        <div class="inline-actions" style="margin-top:8px;">
          <button class="btn ghost" data-action="delete-chapter" data-id="${chapter.id}" data-novel="${novelId}">Delete</button>
        </div>
      </div>`
  );
  document.getElementById("authorChapters").innerHTML = cards.join("") || "<div class='callout'>No chapters yet.</div>";
}

async function loadPosts() {
  const result = await supabase
    .from("posts")
    .select("id, title, status, created_at")
    .eq("author_id", state.user.id)
    .order("created_at", { ascending: false });
  if (result.error) {
    document.getElementById("authorPosts").textContent = result.error.message;
    return;
  }
  const cards = (result.data || []).map(
    (post) => `
      <div class="form-card" style="margin-bottom:12px;">
        <strong>${escapeHTML(post.title || "Untitled")}</strong>
        <div style="color:#666;font-size:12px;">${escapeHTML(post.status || "draft")}</div>
      </div>`
  );
  document.getElementById("authorPosts").innerHTML = cards.join("") || "<div class='callout'>No posts yet.</div>";
}

async function init() {
  setupTabs();
  state.user = await getCurrentUserWithRole();
  if (!state.user || !["author", "moderator", "admin", "super"].includes(getUserRole(state.user))) {
    document.body.innerHTML = "<h1>Access Denied</h1><p>Author access only.</p>";
    return;
  }

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await signOut();
    window.location.href = "../index.html";
  });

  document.getElementById("novelForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const payload = {
      id: crypto.randomUUID(),
      author_id: state.user.id,
      author_name: getDisplayName(state.user),
      title: document.getElementById("novelTitle").value.trim(),
      synopsis: document.getElementById("novelSynopsis").value.trim(),
      genre: document.getElementById("novelGenre").value.trim(),
      status: document.getElementById("novelStatus").value,
      created_at: new Date().toISOString()
    };
    const result = await supabase.from("novels").insert(payload);
    if (result.error) {
      setStatus("novelStatusMsg", result.error.message, true);
      return;
    }
    setStatus("novelStatusMsg", "Novel saved.");
    await loadNovels();
  });

  document.getElementById("chapterForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const novelId = document.getElementById("chapterNovel").value;
    const payload = {
      id: crypto.randomUUID(),
      novel_id: novelId,
      chapter_number: Number.parseInt(document.getElementById("chapterNumber").value, 10) || 1,
      title: document.getElementById("chapterTitle").value.trim(),
      content: document.getElementById("chapterContent").value.trim(),
      created_at: new Date().toISOString()
    };
    const result = await supabase.from("chapters").insert(payload);
    if (result.error) {
      setStatus("chapterStatusMsg", result.error.message, true);
      return;
    }
    setStatus("chapterStatusMsg", "Chapter added.");
    await loadChapters(novelId);
  });

  document.body.addEventListener("click", async (event) => {
    const btn = event.target.closest("button[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "delete-novel") {
      await supabase.from("novels").delete().eq("id", btn.dataset.id);
      await loadNovels();
    }
    if (btn.dataset.action === "delete-chapter") {
      await supabase.from("chapters").delete().eq("id", btn.dataset.id);
      await loadChapters(btn.dataset.novel);
    }
  });

  await loadNovels();
  if (state.novels[0]) {
    await loadChapters(state.novels[0].id);
  }
  await loadPosts();
}

init();
