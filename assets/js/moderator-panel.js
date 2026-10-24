import { supabase, getCurrentUserWithRole, getUserRole, signOut } from "./supabase.js";
import { escapeHTML } from "./utils.js";

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

function renderReports(){
 const filter=document.getElementById("modReportFilter")?.value||"open";
 const search=(document.getElementById("modReportSearch")?.value||"").trim().toLowerCase();
 const selected=state.reports.filter(r=>
  (filter==="all"||r.status===filter||(filter==="open"&&["open","pending"].includes(r.status||"open"))) &&
  (!search||[r.content_type,r.reason,r.id].some(x=>String(x||"").toLowerCase().includes(search)))
 );
 const count=document.getElementById("modReportCount");
 if(count)count.textContent=selected.length+" matching reports from the latest "+state.reports.length+" records.";
 const target={posts:"../post.html?id=",post:"../post.html?id=",user:"../profile.html?id=",profile:"../profile.html?id=",marketplace_item:"../marketplace.html?item="};
 renderList("modReports",selected.map(r=>{
  const pending=["open","pending"].includes(r.status||"open");
  const href=target[r.content_type]||"";
  const open=href&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(r.content_id||"")
    ?'<a class="btn ghost" href="'+href+encodeURIComponent(r.content_id)+'" target="_blank" rel="noopener noreferrer">Review item</a>':"";
  return `<article class="form-card" style="margin-bottom:12px">
    <strong>${escapeHTML(r.content_type||"Report")}</strong>
    <p style="font-size:13px;color:var(--color-text,#20303a);overflow-wrap:anywhere">${escapeHTML(r.reason||"No reason")}</p>
    <p class="hint">Status: ${escapeHTML(r.status||"open")}</p>
    <div class="inline-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
      ${open}
      ${pending?'<button class="btn ghost" data-action="resolve-report" data-id="'+r.id+'">Mark reviewed</button><button class="btn ghost" data-action="dismiss-report" data-id="'+r.id+'">Dismiss</button>':""}
    </div></article>`;
 }),"No matching reports. Change the filter or search.");
}
async function loadReports(){
 const result=await supabase.from("content_reports").select("id,content_type,content_id,reason,status,created_at")
  .order("created_at",{ascending:false}).limit(100);
 if(result.error)return renderList("modReports",[],escapeHTML(result.error.message));
 state.reports=result.data||[];renderReports();
}
async function updateReportStatus(reportId, status) {
  if(!["resolved","dismissed"].includes(status))throw Error("Unsupported report decision.");
  // Only the staff-only RPC can complete and audit a report decision.
  return moderateContent(status==="resolved"?"resolve":"dismiss","content_reports",reportId);
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
    } catch (err) {
      window.appUI.toast(err.message || "Action failed.");
    } finally {
      button.disabled = false;
    }
  });

  document.body.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action='resolve-report'],button[data-action='dismiss-report']");
    if (!button) return;
    const reportId = button.dataset.id;
    if (!reportId) return;
    const resolve=button.dataset.action==="resolve-report";
    if(!await window.appUI.confirm(resolve?
      "Confirm that you reviewed the complaint and took any needed action. Marking reviewed does not automatically sanction the reported account.":
      "Dismiss this report as unsubstantiated or requiring no further action?"))return;
    button.disabled = true;
    try {
      await updateReportStatus(reportId, resolve ? "resolved" : "dismissed");
      await loadReports();
    } catch (err) {
      window.appUI.toast(err.message || "Report update failed.");
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

  document.getElementById("modReportSearch")?.addEventListener("input",renderReports);
  document.getElementById("modReportFilter")?.addEventListener("change",renderReports);
  document.getElementById("modReportsRefresh")?.addEventListener("click",()=>void loadReports());
  bindModerationActions();
  await refreshAll();
  // A staff overview can link directly to a report without showing the wrong tab.
  const requested=new URLSearchParams(window.location.search).get("tab");
  if(["posts","comments","discussions","marketplace","videos","novels","reports"].includes(requested)){
    document.querySelector('.admin-nav button[data-tab="'+requested+'"]')?.click();
  }
}

init();
