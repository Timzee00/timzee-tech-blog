import { supabase, getCurrentUserWithRole, getUserRole, signOut } from "./supabase.js";
import { escapeHTML } from "./utils.js";
import {mountReportInvestigator,loadReportQueue} from "./moderation-case-ui.mjs";
import {mountSafetyFlags,loadSafetyFlags} from "./moderation-flags-ui.mjs";

const state = {
  user: null,
  reports: []
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

async function moderateContent(action, type, id) {
  const token = await getAuthToken();
  if(!token)throw Error("Your moderator session expired. Sign in again.");
  const requestId=crypto.randomUUID();
  const res = await fetch("/.netlify/functions/moderate-content", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ action, type, id, requestId })
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
  const result = await supabase.from("posts").select("id, title, status, author_name, created_at").order("created_at", { ascending: false }).limit(50);
  if (result.error) return renderList("modPosts", [], result.error.message);
  renderList("modPosts", (result.data || []).map((post) => `
    <div class="form-card" style="margin-bottom:12px;">
      <strong>${escapeHTML(post.title || "Untitled")}</strong>
      <div style="color:#666;font-size:12px;">${escapeHTML(post.author_name || "Unknown")} • ${escapeHTML(post.status || "draft")}</div>
      <div class="inline-actions" style="margin-top:8px;">
        <button class="btn ghost" data-action="publish" data-id="${post.id}" data-type="posts">Publish</button>
        <button class="btn ghost" data-action="unpublish" data-id="${post.id}" data-type="posts">Unpublish</button>
        <button class="btn danger" data-action="delete" data-id="${post.id}" data-type="posts">Delete</button>
      </div>
    </div>`), "No posts found.");
}

async function loadComments() {
  const result = await supabase.from("comments").select("id, post_id, body, status, created_at").order("created_at", { ascending: false }).limit(50);
  if (result.error) return renderList("modComments", [], result.error.message);
  renderList("modComments", (result.data || []).map((comment) => `
    <div class="form-card" style="margin-bottom:12px;">
      <div style="font-size:13px;">${escapeHTML(comment.body || "")}</div>
      <div style="color:#666;font-size:12px;">Status: ${escapeHTML(comment.status || "pending")}</div>
      <div class="inline-actions" style="margin-top:8px;">
        <button class="btn ghost" data-action="approve" data-id="${comment.id}" data-type="comments">Approve</button>
        <button class="btn ghost" data-action="hide" data-id="${comment.id}" data-type="comments">Hide</button>
        <button class="btn danger" data-action="delete" data-id="${comment.id}" data-type="comments">Delete</button>
      </div>
    </div>`), "No comments found.");
}

async function loadDiscussions() {
  const result = await supabase.from("discussion_messages").select("id, topic_id, body, created_at").order("created_at", { ascending: false }).limit(50);
  if (result.error) return renderList("modDiscussions", [], result.error.message);
  renderList("modDiscussions", (result.data || []).map((msg) => `
    <div class="form-card" style="margin-bottom:12px;">
      <div style="font-size:13px;">${escapeHTML(msg.body || "")}</div>
      <div class="inline-actions" style="margin-top:8px;">
        <button class="btn danger" data-action="delete" data-id="${msg.id}" data-type="discussion_messages">Delete</button>
      </div>
    </div>`), "No discussion messages found.");
}

async function loadMarketplace() {
  const result = await supabase.from("marketplace_items").select("id, title, is_available, created_at").order("created_at", { ascending: false }).limit(50);
  if (result.error) return renderList("modMarketplace", [], result.error.message);
  renderList("modMarketplace", (result.data || []).map((item) => `
    <div class="form-card" style="margin-bottom:12px;">
      <strong>${escapeHTML(item.title || "Untitled")}</strong>
      <div style="color:#666;font-size:12px;">Available: ${item.is_available ? "Yes" : "No"}</div>
      <div class="inline-actions" style="margin-top:8px;">
        <button class="btn ghost" data-action="hide" data-id="${item.id}" data-type="marketplace_items">Hide</button>
        <button class="btn danger" data-action="delete" data-id="${item.id}" data-type="marketplace_items">Delete</button>
      </div>
    </div>`), "No marketplace items found.");
}

async function loadVideos() {
  const result = await supabase.from("videos").select("id, title, is_public, created_at").order("created_at", { ascending: false }).limit(50);
  if (result.error) return renderList("modVideos", [], result.error.message);
  renderList("modVideos", (result.data || []).map((video) => `
    <div class="form-card" style="margin-bottom:12px;">
      <strong>${escapeHTML(video.title || "Untitled")}</strong>
      <div style="color:#666;font-size:12px;">Public: ${video.is_public ? "Yes" : "No"}</div>
      <div class="inline-actions" style="margin-top:8px;">
        <button class="btn ghost" data-action="hide" data-id="${video.id}" data-type="videos">Hide</button>
        <button class="btn danger" data-action="delete" data-id="${video.id}" data-type="videos">Delete</button>
      </div>
    </div>`), "No videos found.");
}

async function loadNovels() {
  const result = await supabase.from("novels").select("id, title, status, created_at").order("created_at", { ascending: false }).limit(50);
  if (result.error) return renderList("modNovels", [], result.error.message);
  renderList("modNovels", (result.data || []).map((novel) => `
    <div class="form-card" style="margin-bottom:12px;">
      <strong>${escapeHTML(novel.title || "Untitled")}</strong>
      <div style="color:#666;font-size:12px;">Status: ${escapeHTML(novel.status || "ongoing")}</div>
      <div class="inline-actions" style="margin-top:8px;">
        <button class="btn ghost" data-action="hide" data-id="${novel.id}" data-type="novels">Pause</button>
        <button class="btn danger" data-action="delete" data-id="${novel.id}" data-type="novels">Delete</button>
      </div>
    </div>`), "No novels found.");
}

function bindModerationActions() {
  document.body.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const action = button.dataset.action;
    const type = button.dataset.type;
    const id = button.dataset.id;
    if (!action || !type || !id || action.endsWith("-report")) return;
    button.disabled = true;
    try {
      await moderateContent(action, type, id);
      await refreshAll();
  await loadSafetyFlags();
    } catch (err) {
      window.appUI.toast(err.message || "Action failed.");
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
  await loadReportQueue();
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

  mountReportInvestigator();
  mountSafetyFlags();
  bindModerationActions();
  await refreshAll();
  // A staff overview can link directly to a report without showing the wrong tab.
  const requested=new URLSearchParams(window.location.search).get("tab");
  if(["posts","comments","discussions","marketplace","videos","novels","reports","flags"].includes(requested)){
    document.querySelector('.admin-nav button[data-tab="'+requested+'"]')?.click();
  }
}

init();
