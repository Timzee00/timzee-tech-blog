import { supabase, getCurrentUserWithRole, getUserRole, signOut } from "./supabase.js";
import { escapeHTML } from "./utils.js";

const state = {
  user: null
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

async function getAuthToken() {
  const { data } = await supabase.auth.getSession();
  return data?.session?.access_token || "";
}

async function moderateContent(action, type, id, payload = {}) {
  const token = await getAuthToken();
  const res = await fetch("/.netlify/functions/moderate-content", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ action, type, id, payload })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Moderation failed.");
  return data;
}

function renderList(containerId, items, emptyText) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!items.length) {
    container.innerHTML = `<div class="callout">${emptyText}</div>`;
    return;
  }
  container.innerHTML = items.join("");
}

async function loadPosts() {
  const containerId = "modPosts";
  const result = await supabase
    .from("posts")
    .select("id, title, status, author_name, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (result.error) {
    renderList(containerId, [], result.error.message);
    return;
  }
  const cards = (result.data || []).map(
    (post) => `
      <div class="form-card" style="margin-bottom:12px;">
        <strong>${escapeHTML(post.title || "Untitled")}</strong>
        <div style="color:#666;font-size:12px;">${escapeHTML(post.author_name || "Unknown")} • ${escapeHTML(post.status || "draft")}</div>
        <div class="inline-actions" style="margin-top:8px;">
          <button class="btn ghost" data-action="publish" data-id="${post.id}" data-type="posts">Publish</button>
          <button class="btn ghost" data-action="unpublish" data-id="${post.id}" data-type="posts">Unpublish</button>
          <button class="btn danger" data-action="delete" data-id="${post.id}" data-type="posts">Delete</button>
        </div>
      </div>`
  );
  renderList(containerId, cards, "No posts found.");
}

async function loadComments() {
  const containerId = "modComments";
  const result = await supabase
    .from("comments")
    .select("id, post_id, body, status, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (result.error) {
    renderList(containerId, [], result.error.message);
    return;
  }
  const cards = (result.data || []).map(
    (comment) => `
      <div class="form-card" style="margin-bottom:12px;">
        <div style="font-size:13px;">${escapeHTML(comment.body || "")}</div>
        <div style="color:#666;font-size:12px;">Status: ${escapeHTML(comment.status || "pending")}</div>
        <div class="inline-actions" style="margin-top:8px;">
          <button class="btn ghost" data-action="approve" data-id="${comment.id}" data-type="comments">Approve</button>
          <button class="btn ghost" data-action="hide" data-id="${comment.id}" data-type="comments">Hide</button>
          <button class="btn danger" data-action="delete" data-id="${comment.id}" data-type="comments">Delete</button>
        </div>
      </div>`
  );
  renderList(containerId, cards, "No comments found.");
}

async function loadDiscussions() {
  const containerId = "modDiscussions";
  const result = await supabase
    .from("discussion_messages")
    .select("id, topic_id, body, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (result.error) {
    renderList(containerId, [], result.error.message);
    return;
  }
  const cards = (result.data || []).map(
    (msg) => `
      <div class="form-card" style="margin-bottom:12px;">
        <div style="font-size:13px;">${escapeHTML(msg.body || "")}</div>
        <div class="inline-actions" style="margin-top:8px;">
          <button class="btn danger" data-action="delete" data-id="${msg.id}" data-type="discussion_messages">Delete</button>
        </div>
      </div>`
  );
  renderList(containerId, cards, "No discussion messages found.");
}

async function loadMarketplace() {
  const containerId = "modMarketplace";
  const result = await supabase
    .from("marketplace_items")
    .select("id, title, is_available, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (result.error) {
    renderList(containerId, [], result.error.message);
    return;
  }
  const cards = (result.data || []).map(
    (item) => `
      <div class="form-card" style="margin-bottom:12px;">
        <strong>${escapeHTML(item.title || "Untitled")}</strong>
        <div style="color:#666;font-size:12px;">Available: ${item.is_available ? "Yes" : "No"}</div>
        <div class="inline-actions" style="margin-top:8px;">
          <button class="btn ghost" data-action="hide" data-id="${item.id}" data-type="marketplace_items">Hide</button>
          <button class="btn danger" data-action="delete" data-id="${item.id}" data-type="marketplace_items">Delete</button>
        </div>
      </div>`
  );
  renderList(containerId, cards, "No marketplace items found.");
}

async function loadVideos() {
  const containerId = "modVideos";
  const result = await supabase
    .from("videos")
    .select("id, title, is_public, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (result.error) {
    renderList(containerId, [], result.error.message);
    return;
  }
  const cards = (result.data || []).map(
    (video) => `
      <div class="form-card" style="margin-bottom:12px;">
        <strong>${escapeHTML(video.title || "Untitled")}</strong>
        <div style="color:#666;font-size:12px;">Public: ${video.is_public ? "Yes" : "No"}</div>
        <div class="inline-actions" style="margin-top:8px;">
          <button class="btn ghost" data-action="hide" data-id="${video.id}" data-type="videos">Hide</button>
          <button class="btn danger" data-action="delete" data-id="${video.id}" data-type="videos">Delete</button>
        </div>
      </div>`
  );
  renderList(containerId, cards, "No videos found.");
}

async function loadNovels() {
  const containerId = "modNovels";
  const result = await supabase
    .from("novels")
    .select("id, title, status, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (result.error) {
    renderList(containerId, [], result.error.message);
    return;
  }
  const cards = (result.data || []).map(
    (novel) => `
      <div class="form-card" style="margin-bottom:12px;">
        <strong>${escapeHTML(novel.title || "Untitled")}</strong>
        <div style="color:#666;font-size:12px;">Status: ${escapeHTML(novel.status || "ongoing")}</div>
        <div class="inline-actions" style="margin-top:8px;">
          <button class="btn ghost" data-action="hide" data-id="${novel.id}" data-type="novels">Pause</button>
          <button class="btn danger" data-action="delete" data-id="${novel.id}" data-type="novels">Delete</button>
        </div>
      </div>`
  );
  renderList(containerId, cards, "No novels found.");
}

async function loadReports() {
  const containerId = "modReports";
  const result = await supabase
    .from("content_reports")
    .select("id, content_type, content_id, reason, status, created_at")
    .order("created_at", { ascending: false })
    .limit(100);
  if (result.error) {
    renderList(containerId, [], result.error.message);
    return;
  }
  const cards = (result.data || []).map(
    (report) => `
      <div class="form-card" style="margin-bottom:12px;">
        <strong>${escapeHTML(report.content_type)}</strong>
        <div style="color:#666;font-size:12px;">${escapeHTML(report.reason || "No reason")}</div>
        <div style="color:#666;font-size:12px;">Status: ${escapeHTML(report.status || "open")}</div>
        <div class="inline-actions" style="margin-top:8px;">
          <button class="btn ghost" data-action="resolve-report" data-id="${report.id}">Resolve</button>
          <button class="btn ghost" data-action="dismiss-report" data-id="${report.id}">Dismiss</button>
        </div>
      </div>`
  );
  renderList(containerId, cards, "No reports found.");
}

function bindModerationActions() {
  document.body.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const type = button.dataset.type;
    const id = button.dataset.id;
    if (!action || !type || !id) return;
    button.disabled = true;
    try {
      await moderateContent(action, type, id);
      await refreshAll();
    } catch (err) {
      alert(err.message || "Action failed.");
    } finally {
      button.disabled = false;
    }
  });

  document.body.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action^='resolve-report'],button[data-action^='dismiss-report']");
    if (!button) return;
    const reportId = button.dataset.id;
    if (!reportId) return;
    button.disabled = true;
    try {
      if (button.dataset.action === "resolve-report") {
        await supabase.from("content_reports").update({ status: "resolved" }).eq("id", reportId);
      } else {
        await supabase.from("content_reports").update({ status: "dismissed" }).eq("id", reportId);
      }
      await loadReports();
    } catch (err) {
      alert(err.message || "Report update failed.");
    } finally {
      button.disabled = false;
    }
  });
}

async function refreshAll() {
  await loadPosts();
  await loadComments();
  await loadDiscussions();
  await loadMarketplace();
  await loadVideos();
  await loadNovels();
  await loadReports();
}

async function init() {
  setupTabs();
  state.user = await getCurrentUserWithRole();
  if (!state.user || !["moderator", "admin", "super"].includes(getUserRole(state.user))) {
    document.body.innerHTML = "<h1>Access Denied</h1><p>Moderator access only.</p>";
    return;
  }

  document.getElementById("logoutBtn")?.addEventListener("click", async () => {
    await signOut();
    window.location.href = "../index.html";
  });

  bindModerationActions();
  await refreshAll();
}

init();
