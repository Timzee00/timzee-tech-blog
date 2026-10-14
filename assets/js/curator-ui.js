/**
 * Professional Curator Bot Management UI
 * Easy-to-use interface for admins to manage RSS sources and bot settings
 * Non-technical users can setup sources and configure the bot
 */

import {
  getAllCuratorSources,
  createCuratorSource,
  deleteCuratorSource,
  toggleCuratorSourceStatus,
  getUnpostedCuratorPosts,
  getPublishedCuratorPosts,
  createCuratorPost,
  markCuratorPostAsPosted,
  deleteCuratorPost,
  getCuratorStats,
  testCuratorSource,
  triggerScoutSync
} from "./curator.js";

import { supabase, getCurrentUserWithRole, getUserRole } from "./supabase.js";
import { escapeHTML, slugify, isSafeUrl, normalizeHtml } from "./utils.js";
import { createPost, createPostMedia } from "./data.js";
import { ROUNDUP_TOPICS, generateRoundupDraft, suggestRoundupIds, trustedExternalUrl, imageUrls, htmlEscape, socialCaption } from "./curator-publishing.mjs";

class CuratorManager {
  constructor() {
    this.publishedPosts = [];
    this.sources = [];
    this.posts = [];
    this.stats = null;
    this.currentUser = null;
    this.roundupIds = new Set();
  }

  async init(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    const user = await getCurrentUserWithRole();
    if (!user || !["admin", "super"].includes(getUserRole(user))) {
      this.container.innerHTML = "<p style='color: var(--color-danger);'>Access denied. Admin only.</p>";
      return;
    }
    this.currentUser = user;
    this.canRunScout = getUserRole(user) === "super";

    this.render();
    await this.load();
    if (this.canRunScout) void this.loadScoutHealth();
  }

  render() {
    this.container.innerHTML = `
      <div class="curator-manager">
        <div class="manager-header">
          <div>
            <h2>🤖 Content Curator Bot</h2>
            <p>Automatically fetch and manage content from RSS feeds and sources</p>
          </div>
          <div class="stats-grid" id="statsGrid">
            <div class="stat-card">
              <div class="stat-label">Active Sources</div>
              <div class="stat-value" id="activeStat">0</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Unposted Articles</div>
              <div class="stat-value" id="unpostedStat">0</div>
            </div>
          </div>
        </div>

        <div class="curator-tabs">
          <button class="tab-btn active" data-tab="dashboard">📊 Dashboard</button>
          <button class="tab-btn" data-tab="sources">📡 Manage Sources</button>
          <button class="tab-btn" data-tab="posts">📰 Articles</button>
        </div>

        <!-- Dashboard Tab -->
        <div class="tab-content" data-tab="dashboard">
          <div class="section-header">
            <h3>Bot Overview</h3>
            <p>Quick status and recent activity</p>
          </div>
          <div class="dashboard-grid">
            <div class="card">
              <h4>📡 Sources</h4>
              <div class="big-stat" id="sourcesCount">0</div>
              <p style="font-size: 12px; color: var(--color-text-muted);">Total active sources feeding content</p>
            </div>
            <div class="card">
              <h4>📰 Articles</h4>
              <div class="big-stat" id="articlesCount">0</div>
              <p style="font-size: 12px; color: var(--color-text-muted);">Pending posts awaiting approval</p>
            </div>
            <div class="card">
              <h4>✓ Posted</h4>
              <div class="big-stat" id="postedCount">0</div>
              <p style="font-size: 12px; color: var(--color-text-muted);">Articles published to site</p>
            </div>
            <div class="card">
              <h4>🔄 Last Sync</h4>
              <div style="padding: 16px 0;">
                <p id="lastSync" style="margin: 0; color: var(--color-text-muted);">Checking scout status…</p>
                <p id="scoutBackendStatus" role="status" style="margin:8px 0 12px;font-size:13px;color:var(--color-text-muted);"></p>
                <button class="btn btn-small" id="syncNowBtn" ${this.canRunScout ? "" : "disabled title=\"Only Super Admins can run the Scout manually\""}>🔄 Sync Now</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Sources Tab -->
        <div class="tab-content" data-tab="sources" style="display: none;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <div>
              <h3>Content Sources</h3>
              <p style="color: var(--color-text-muted); margin: 0;">RSS feeds and content sources for the bot to monitor</p>
            </div>
            <div style="display:flex; gap:8px; align-items:center;">
              <button class="btn btn-primary" id="addSourceBtn">+ Add Source</button>
              <button class="btn btn-ghost" id="importFeedsBtn">Import Recommended Feeds</button>
            </div>
          </div>

          <div id="addSourceForm" class="form-card" style="display: none; margin-bottom: 20px;">
            <h4>Add New Source</h4>
            <div class="form-group">
              <label>Source Name *</label>
              <input type="text" id="sourceName" placeholder="e.g., TechCrunch RSS" required>
            </div>
            <div class="form-group">
              <label>RSS Feed URL *</label>
              <input type="url" id="sourceUrl" placeholder="https://example.com/feed.xml" required>
            </div>
            <div class="form-group">
              <label>Source Type</label>
              <select id="sourceType">
                <option value="rss">RSS Feed</option>
                <option value="gdelt">GDELT Query</option>
              </select>
            </div>
            <div class="form-group">
              <label>Max Articles Per Fetch</label>
              <input type="number" id="sourceMaxItems" min="1" max="100" value="30">
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn btn-primary" id="confirmSourceBtn">✓ Add Source</button>
              <button class="btn btn-ghost" id="cancelSourceBtn">✕ Cancel</button>
            </div>
          </div>

          <div class="sources-list" id="sourcesList">
            <div style="text-align: center; padding: 40px; color: var(--color-text-muted);">Loading sources...</div>
          </div>
        </div>

        <!-- Posts Tab -->
        <div class="tab-content" data-tab="posts" style="display: none;">
          <div class="section-header">
            <h3>Articles Queue</h3>
            <p>Review and approve articles before posting</p>
          </div>
          <div class="curator-roundup-controls" style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:16px;">
            <label for="roundupTopic">Roundup category</label>
            <select id="roundupTopic" class="field">
              ${ROUNDUP_TOPICS.map(topic => '<option value="'+htmlEscape(topic)+'">'+htmlEscape(topic)+'</option>').join("")}
            </select>
            <button type="button" class="btn ghost" id="suggestCuratorRoundup">Suggest related stories</button>
            <button type="button" class="btn ghost" id="createCuratorRoundup">Group selected stories into draft</button>
            <span id="roundupSelectionCount" role="status">0 selected (2–6 required)</span>
          </div>
          <div id="postsList" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px;">
            <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--color-text-muted);">Loading articles...</div>
          </div>
          <section class="curator-published-repairs" aria-labelledby="publishedRepairTitle">
            <h3 id="publishedRepairTitle">Published article galleries</h3>
            <p>Repair missing images without duplicating the published article. Only attach images you are licensed to reuse.</p>
            <div id="publishedMediaRepairs" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;"></div>
          </section>
        </div>
      </div>

      <style>
        .curator-manager { margin: 20px 0; }
        .manager-header { display: grid; grid-template-columns: 1fr auto; gap: 30px; align-items: start; margin-bottom: 30px; }
        .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .stat-card {
          background: var(--color-primary);
          color: var(--color-text-on-primary);
          padding: 16px;
          border-radius: 8px;
        }
        .stat-label { font-size: 12px; opacity: 0.9; }
        .stat-value { font-size: 24px; font-weight: 700; margin-top: 4px; }

        .curator-tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 2px solid var(--color-border); }
        .tab-btn {
          padding: 12px 16px;
          border: none;
          background: transparent;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          color: var(--color-text-muted);
          border-bottom: 3px solid transparent;
          transition: all 0.2s;
        }
        .tab-btn:hover { color: var(--color-text); }
        .tab-btn.active { color: var(--color-primary); border-bottom-color: var(--color-primary); }

        .dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
        .card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 8px; padding: 20px; }
        .card h4 { margin: 0 0 12px 0; font-size: 14px; }
        .big-stat { font-size: 32px; font-weight: 700; color: var(--color-primary); }

        .form-card { background: var(--color-surface-muted); border: 1px solid var(--color-border); border-radius: 8px; padding: 20px; }
        .form-group { margin-bottom: 16px; }
        .form-group label { display: block; font-weight: 600; margin-bottom: 6px; font-size: 14px; }
        .form-group input, .form-group textarea, .form-group select {
          width: 100%;
          padding: 10px;
          border: 1px solid #ddd;
          border-radius: 6px;
          font-family: inherit;
          font-size: 14px;
        }

        .section-header { margin-bottom: 20px; }
        .section-header h3 { margin: 0 0 4px 0; }
        .section-header p { margin: 0; color: var(--color-text-muted); font-size: 14px; }

        .source-item {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 12px;
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
        }
        .source-info h4 { margin: 0 0 4px 0; }
        .source-info p { margin: 2px 0; font-size: 12px; color: var(--color-text-muted); }
        .source-actions { display: flex; gap: 8px; }

        .btn { padding: 8px 12px; border-radius: 6px; border: 1px solid #ddd; cursor: pointer; font-weight: 600; transition: all 0.2s; font-size: 12px; }
        .btn-small { padding: 6px 10px; font-size: 11px; }
        .btn-primary { background: var(--color-primary); color: var(--color-text-on-primary); border-color: var(--color-primary); }
        .btn-primary:hover { background: var(--color-primary-hover); }
        .btn-ghost { background: var(--color-surface); color: var(--color-text); }
        .btn-ghost:hover { background: var(--color-surface-muted); }
        .btn-danger { background: #b42318; color: #fff; border-color: #ef4444; }

        .post-card {
          background: var(--color-surface);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .post-title { font-weight: 600; line-height: 1.4; }
        .post-meta { font-size: 12px; color: var(--color-text-muted); }
        .post-actions { display: flex; gap: 8px; }
      </style>
    `;

    this.attachEventListeners();
  }

  attachEventListeners() {
    // Tab switching
    const tabBtns = this.container.querySelectorAll(".tab-btn");
    const tabContents = this.container.querySelectorAll(".tab-content");

    tabBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        const tab = btn.dataset.tab;
        tabBtns.forEach(b => { b.classList.remove("active"); b.setAttribute("aria-pressed", "false"); });
        tabContents.forEach(c => c.style.display = "none");
        btn.classList.add("active");
        btn.setAttribute("aria-pressed", "true");
        this.container.querySelector(`.tab-content[data-tab="${tab}"]`).style.display = "block";
      });
    });

    this.container.querySelector("#createCuratorRoundup")?.addEventListener("click",()=>void this.createRoundup());
    this.container.querySelector("#suggestCuratorRoundup")?.addEventListener("click",()=>this.suggestRoundup());

    // Add source
    this.container.querySelector("#addSourceBtn").addEventListener("click", () => {
      this.container.querySelector("#addSourceForm").style.display = "block";
      this.container.querySelector("#sourceName").focus();
    });

    this.container.querySelector("#cancelSourceBtn").addEventListener("click", () => {
      this.resetSourceForm();
    });

    this.container.querySelector("#confirmSourceBtn").addEventListener("click", () => {
      this.handleAddSource();
    });

    // Sync button — actually runs the scout-news bot now (previously just
    // showed a fake alert and did nothing)
    this.container.querySelector("#syncNowBtn").addEventListener("click", (e) => {
      this.handleSyncNow(e.currentTarget);
    });

    // Import recommended feeds
    const importBtn = this.container.querySelector("#importFeedsBtn");
    if (importBtn) {
      importBtn.addEventListener("click", async () => {
        importBtn.disabled = true;
        importBtn.textContent = "Importing...";
        try {
          await this.importRecommendedFeeds();
          window.appUI.toast("Recommended feeds imported. Check the sources list.");
          await this.load();
        } catch (err) {
          console.error("Import failed:", err);
          window.appUI.toast("Import failed: " + (err.message || err));
        } finally {
          importBtn.disabled = false;
          importBtn.textContent = "Import Recommended Feeds";
        }
      });
    }
  }

  async handleSyncNow(btn) {
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "🔄 Syncing...";
    const lastSync = this.container.querySelector("#lastSync");
    try {
      const result = await triggerScoutSync();
      const count = result.posted ? result.posted.length : 0;
      const status=result.status || "unknown";
      const errorCount = result.feedErrors ? result.feedErrors.length : 0;
      if (lastSync) {
        lastSync.textContent = `Sync ${status} at ${new Date().toLocaleTimeString()} — ${count} new draft${count === 1 ? "" : "s"}${errorCount ? `, ${errorCount} source error${errorCount === 1 ? "" : "s"}` : ""}`;
      }
      await this.load();
      void this.loadScoutHealth();
    } catch (error) {
      if (lastSync) lastSync.textContent = `Sync failed: ${error.message}`;
      window.appUI.toast(`Sync failed: ${error.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  async loadScoutHealth() {
    const status = this.container.querySelector("#scoutBackendStatus");
    const lastSync = this.container.querySelector("#lastSync");
    if (!this.canRunScout) return;
    try {
      const session = await supabase.auth.getSession();
      const token = session.data?.session?.access_token;
      if (!token) throw Error("Sign in again to inspect the Scout.");
      const response = await fetch("/.netlify/functions/scout-news-status", {
        method: "GET", headers: { Authorization: "Bearer " + token }, cache: "no-store"
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw Error(payload.error || "Scout diagnostics unavailable on this deployment.");
      if (lastSync) {
        const date = payload.lastRunAt ? new Date(payload.lastRunAt).toLocaleString() : "Never";
        lastSync.textContent = `Last run: ${date} — ${payload.lastStatus}`;
      }
      if (status) {
        status.textContent = `${payload.activeSources} enabled sources · ${payload.importedArticles} imported articles. ` +
          (payload.lastRunFailed ? "Last run failed; check source failures in Netlify logs." :
          payload.enabled ? "Scout enabled." : "Scout disabled in settings.");
      }
    } catch (error) {
      if (status) status.textContent = error.message || "Could not inspect scout status.";
    }
  }

  async load() {
    try {
      this.sources = await getAllCuratorSources();
      this.posts = await getUnpostedCuratorPosts(50);
      try { this.publishedPosts = await getPublishedCuratorPosts(20); }
      catch(error) { console.warn("Published gallery history unavailable",error); this.publishedPosts=[]; }
      this.stats = await getCuratorStats();

      this.renderStats();
      this.renderSources();
      this.renderPosts();
      this.renderMediaRepairs();
    } catch (error) {
      console.error("Error loading curator data:", error);
    }
  }

  renderStats() {
    if (this.stats) {
      this.container.querySelector("#activeStat").textContent = this.stats.activeSources;
      this.container.querySelector("#unpostedStat").textContent = this.stats.unpostedPosts;
      this.container.querySelector("#sourcesCount").textContent = this.stats.activeSources;
      this.container.querySelector("#articlesCount").textContent = this.stats.unpostedPosts;
      this.container.querySelector("#postedCount").textContent = this.stats.totalPosts - this.stats.unpostedPosts;
    }
  }

  renderSources() {
    const list = this.container.querySelector("#sourcesList");
    if (!this.sources.length) {
      list.innerHTML = "<div style='text-align: center; padding: 40px; color: var(--color-text-muted); grid-column: 1/-1;'>No sources configured. Add your first RSS feed!</div>";
      return;
    }

    list.innerHTML = this.sources.map(source => {
      const active = typeof source.enabled === "boolean" ? source.enabled : source.is_active === true;
      const failures = Math.max(0, Number(source.failure_count) || 0);
      const checkedAt = source.last_fetched_at
        ? new Date(source.last_fetched_at).toLocaleString() : "Never checked";
      // Source failure details are escaped, and only displayed to staff.
      const lastError = source.last_error
        ? `<p class="curator-source-error" role="status">Last error: ${escapeHTML(String(source.last_error).slice(0, 250))}</p>`
        : "";
      return `
      <div class="source-item">
        <div class="source-info">
          <h4>${escapeHTML(source.name || '')}</h4>
          <p>${escapeHTML(source.feed_url || source.query || 'No feed URL')}</p>
          <p style="font-size: 11px; color: var(--color-primary);">📡 ${escapeHTML(String(source.source_type || '').toUpperCase())} • 📄 Up to ${escapeHTML(String(source.max_items ?? 30))} articles per sync</p>
          <p style="font-size:12px;color:var(--color-text-muted);">Last checked: ${escapeHTML(checkedAt)} · ${failures} failure${failures === 1 ? "" : "s"}</p>
          ${lastError}
        </div>
        <div class="source-actions">
          <button class="btn ${active ? "btn-ghost" : "btn-danger"}" data-source-id="${source.id}" data-type="toggle-source">
            ${active ? "🟢 Active" : "⚪ Inactive"}
          </button>
          <button class="btn btn-danger" data-source-id="${source.id}" data-type="delete-source">
            Delete
          </button>
        </div>
      </div>
    `}).join("");

    list.querySelectorAll(".btn").forEach(btn => {
      btn.addEventListener("click", (e) => this.handleSourceAction(e, btn));
    });
  }

  renderPosts() {
    const list = this.container.querySelector("#postsList");
    if (!this.posts.length) {
      list.innerHTML = "<div style='grid-column: 1/-1; text-align: center; padding: 40px; color: var(--color-text-muted);'>No pending articles</div>";
      return;
    }

    list.innerHTML = this.posts.map(post => {
      const candidates=[...String(post.content||"").matchAll(/data-curator-image-candidate="([^"]+)"/g)]
        .map(match=>{try{return decodeURIComponent(match[1]);}catch{return "";}}).filter(Boolean);
      const dateText = post.published_at ? new Date(post.published_at).toLocaleDateString() : "Unknown date";
      const wordCount = String(post.content || "").replace(/<[^>]*>/g, " ").trim().split(/\s+/).filter(Boolean).length;
      const isSourceBrief=String(post.content||"").includes("Editorial status:");
      const editorialStatus = isSourceBrief || wordCount < 450
        ? "Source brief — expand with evidence and fact-check before publishing."
        : "Article draft · " + wordCount + " words · Fact-check before publishing.";
      return `
      <div class="post-card">
        <label class="curator-roundup-choice"><input type="checkbox" data-roundup-id="${post.id}" ${this.roundupIds.has(post.id)?"checked":""}> Include in roundup</label>
        <div class="post-title">${escapeHTML(post.title || '')}</div>
        <div class="post-meta">
          Source: ${escapeHTML(post.curator_sources?.name || post.source_name || 'Unknown')} • ${escapeHTML(dateText)}
        </div>
        <p style="font-size: 13px; color: var(--color-text-muted); margin: 0;">${escapeHTML(post.excerpt || 'No summary available')}</p>
        <p class="curator-source-ref">Source: <a href="${isSafeUrl(post.source_url || '') ? escapeHTML(post.source_url) : '#'}" target="_blank" rel="noopener noreferrer">Original report ↗</a></p>
        <p class="curator-editorial-state" data-editorial-state="${post.id}" role="status">${escapeHTML(editorialStatus)}</p>
        <details class="curator-media-editor">
          <summary>Images and embeds (up to six)</summary>
          <p>Source images are previews only. Add approved HTTPS image URLs, one per line. Publishing requires confirmed image rights.</p>
          ${post.image_url && trustedExternalUrl(post.image_url)?'<img class="curator-image-preview" loading="lazy" referrerpolicy="no-referrer" alt="Source image preview - rights not verified" src="'+escapeHTML(post.image_url)+'" style="max-width:180px;max-height:120px;object-fit:contain;">':""}
          <label>Approved image URLs<textarea data-curator-images="${post.id}" rows="3" class="field" placeholder="https://example.com/licensed-image.jpg">${escapeHTML(candidates.join("\n"))}</textarea></label>
          <label>Image credit and permission reference<input data-curator-image-credit="${post.id}" class="field" placeholder="Photographer / license / permission link"></label>
          <label><input type="checkbox" data-curator-image-rights="${post.id}"> I verified permission to display these images on Timzee Tech Hub</label>
        </details>
        <div class="post-actions">
          <button class="btn btn-ghost" data-post-id="${post.id}" data-type="post-preview">Preview post</button>
          <button class="btn btn-ghost" data-post-id="${post.id}" data-type="post-translate">Translate to English</button>
          <button class="btn btn-ghost" data-post-id="${post.id}" data-type="post-expand">Expand with AI</button>
          <button class="btn btn-primary" data-post-id="${post.id}" data-type="post-approve">✓ Approve & Post</button>
          <button class="btn btn-ghost" data-post-id="${post.id}" data-type="post-delete">✕ Reject</button>
        </div>
      </div>
    `}).join("");

    list.querySelectorAll(".btn").forEach(btn => {
      btn.addEventListener("click", (e) => this.handlePostAction(e, btn));
    });
    list.querySelectorAll("[data-roundup-id]").forEach(box=>box.addEventListener("change",()=>{
      if(box.checked)this.roundupIds.add(box.dataset.roundupId);
      else this.roundupIds.delete(box.dataset.roundupId);
      this.container.querySelector("#roundupSelectionCount").textContent=this.roundupIds.size+" selected (2–6 required)";
    }));
    this.container.querySelector("#roundupSelectionCount").textContent=this.roundupIds.size+" selected (2–6 required)";
  }

  suggestRoundup(){
    const topic=this.container.querySelector("#roundupTopic")?.value||"";
    const ids=suggestRoundupIds(this.posts,topic);
    if(ids.length<2){
      window.appUI.toast("Not enough matching source briefs. Select two or more verified items manually.",{tone:"warning"});
      return;
    }
    this.roundupIds=new Set(ids);
    this.renderPosts();
    window.appUI.toast(ids.length+" matching "+topic+" stories selected for human review. Verify their relevance before grouping.");
  }

  async createRoundup(){
    const topic=this.container.querySelector("#roundupTopic")?.value||"";
    const chosen=this.posts.filter(post=>this.roundupIds.has(post.id));
    try{
      const draft=generateRoundupDraft(chosen,topic);
      if(!await window.appUI.confirm("Save "+chosen.length+" stories as one "+topic+" roundup draft? Verify every source and deadline before publication."))return;
      await createCuratorPost(draft);
      this.roundupIds.clear();
      await this.load();
      window.appUI.toast("Roundup saved as a source-attributed draft. Expand and fact-check it before publication.");
    }catch(error){window.appUI.toast(error.message||"Roundup creation failed.",{tone:"error"});}
  }

  renderMediaRepairs() {
    const list=this.container.querySelector("#publishedMediaRepairs");
    if(!list)return;
    const rows=this.publishedPosts.filter(post=>post.post_id);
    if(!rows.length){list.textContent="No recently published curator articles.";return;}
    list.innerHTML=rows.map(post=>`
      <div class="post-card">
        <strong>${escapeHTML(post.title || "Curated article")}</strong>
        <p><a href="post.html?id=${encodeURIComponent(post.post_id)}" target="_blank" rel="noopener noreferrer">View published article</a></p>
        <label>Approved image URLs (one per line, up to six)
          <textarea class="field" rows="2" data-repair-images="${post.id}"></textarea>
        </label>
        <label>Photographer, license or permission reference
          <input class="field" data-repair-credit="${post.id}" placeholder="License and image source">
        </label>
        <label><input type="checkbox" data-repair-rights="${post.id}"> Rights verified for all images</label>
        <button type="button" class="btn ghost" data-repair-gallery="${post.id}">Attach missing images</button>
      </div>`).join("");
    list.querySelectorAll("[data-repair-gallery]").forEach(btn=>btn.addEventListener("click",()=>void this.repairGallery(btn.dataset.repairGallery,btn)));
  }

  async attachMissingGallery(postId,urls){
    const query=await supabase.from("post_media").select("url,sort_order").eq("post_id",postId);
    if(query.error)throw query.error;
    const existing=new Set((query.data||[]).map(item=>item.url));
    let next=Math.max(0,...(query.data||[]).map(item=>Number(item.sort_order)||0))+1;
    const failed=[];
    for(const url of urls){
      if(existing.has(url))continue;
      const result=await createPostMedia({id:crypto.randomUUID(),post_id:postId,url,media_type:"image",sort_order:next++});
      if(result.error)failed.push(result.error.message||"Could not attach image");
      else existing.add(url);
    }
    return failed;
  }

  async repairGallery(curatorId,btn){
    const post=this.publishedPosts.find(item=>item.id===curatorId);
    if(!post?.post_id)return;
    const urls=imageUrls(this.container.querySelector('[data-repair-images="'+curatorId+'"]')?.value||"");
    const rights=this.container.querySelector('[data-repair-rights="'+curatorId+'"]')?.checked;
    const credit=this.container.querySelector('[data-repair-credit="'+curatorId+'"]')?.value.trim()||"";
    if(!urls.length||!rights||credit.length<5){
      window.appUI.toast("Enter approved images, verify rights, and provide an attribution reference.",{tone:"warning"});return;
    }
    btn.disabled=true;
    try{
      const failed=await this.attachMissingGallery(post.post_id,urls);
      if(failed.length)throw Error(failed[0]);
      window.appUI.toast("Existing images kept; missing gallery images attached.",{tone:"success"});
    }catch(e){window.appUI.toast("Gallery repair incomplete: "+e.message,{tone:"error"});}
    finally{btn.disabled=false;}
  }

  async handleSourceAction(e, btn) {
    const sourceId = btn.dataset.sourceId;
    const type = btn.dataset.type;

    if (type === "toggle-source") {
      const source = this.sources.find(s => s.id === sourceId);
      if (!source) return;
      const currentlyEnabled = typeof source.enabled === "boolean" ? source.enabled : source.is_active === true;
      await toggleCuratorSourceStatus(sourceId, !currentlyEnabled);
      await this.load();
    } else if (type === "delete-source") {
      if (await window.appUI.confirm("Delete this source? This cannot be undone.")) {
        await deleteCuratorSource(sourceId);
        await this.load();
      }
    }
  }

  async handlePostAction(e, btn) {
    const postId = btn.dataset.postId;
    const type = btn.dataset.type;

    if (type === "post-preview") {
      this.previewCuratorPost(postId);
    } else if (type === "post-translate") {
      await this.translateCuratorPost(postId,btn);
    } else if (type === "post-expand") {
      await this.expandCuratorPost(postId, btn);
    } else if (type === "post-approve") {
      await this.approveCuratorPost(postId, btn);
    } else if (type === "post-delete") {
      if (await window.appUI.confirm("Reject this article?")) {
        await deleteCuratorPost(postId);
        await this.load();
      }
    }
  }

  previewCuratorPost(id) {
    const post=this.posts.find(item=>item.id===id);
    if(!post)return;
    // This is a local visual preview; no published post is created.
    const selected=imageUrls(this.container.querySelector('[data-curator-images="'+id+'"]')?.value||"");
    const permitted=this.container.querySelector('[data-curator-image-rights="'+id+'"]')?.checked===true;
    const media=selected.length?selected:post.image_url && trustedExternalUrl(post.image_url)?[post.image_url]:[];
    const credited=this.container.querySelector('[data-curator-image-credit="'+id+'"]')?.value.trim()||"";
    const doc=new DOMParser().parseFromString(String(post.content||""),"text/html");
    const takeawayTag=doc.querySelector("[data-timzee-takeaways]")?.getAttribute("data-timzee-takeaways");
    let insights=[];
    try {
      const parsed=JSON.parse(decodeURIComponent(takeawayTag||""));
      if(Array.isArray(parsed))insights=parsed.filter(x=>typeof x==="string").slice(0,4);
    }catch{}
    const dialog=document.createElement("dialog");
    dialog.className="curator-post-preview-dialog";
    dialog.setAttribute("aria-label","Preview curated article");
    const imageHtml=media.filter(trustedExternalUrl).slice(0,6).map((url,i)=>
      '<figure><img src="'+escapeHTML(url)+'" alt="Proposed curated image '+(i+1)+'" loading="lazy" referrerpolicy="no-referrer"></figure>'
    ).join("");
    dialog.innerHTML=
      '<div class="curator-preview-toolbar"><strong>Unpublished article preview</strong><button type="button" class="btn ghost curator-preview-close">Close</button></div>'+
      '<div class="curator-preview-body"><article class="post-shell post-article">'+
      '<p class="post-kicker">'+escapeHTML((post.tags||[])[0]||"General")+' · '+escapeHTML(post.source_name||"Curator")+'</p>'+
      '<h1>'+escapeHTML(post.title||"Untitled")+'</h1>'+
      '<p class="post-dek">'+escapeHTML(post.excerpt||"")+'</p>'+
      (imageHtml?'<div class="curator-preview-gallery">'+imageHtml+'</div>':'')+
      (insights.length?'<section class="post-highlights"><h2>Key Takeaways</h2><ul>'+
         insights.map(i=>'<li>'+escapeHTML(i)+'</li>').join("")+'</ul></section>':'')+
      '<div class="post-content">'+normalizeHtml(post.content||"")+'</div>'+
      '<p class="curator-preview-note">'+
      (permitted?'Images marked as rights-verified by editor. ':'Image rights are not confirmed. ')+
      (credited?'Credit: '+escapeHTML(credited)+'. ':'')+
      'This is a private preview and has not been published.</p></article></div>';
    document.body.append(dialog);
    const close=()=>dialog.close();
    dialog.querySelector(".curator-preview-close")?.addEventListener("click",close);
    dialog.addEventListener("close",()=>dialog.remove(),{once:true});
    dialog.addEventListener("click",e=>{if(e.target===dialog)close();});
    if(typeof dialog.showModal==="function")dialog.showModal();
    else dialog.setAttribute("open","");
  }

  async translateCuratorPost(id,button) {
    if(!await window.appUI.confirm("Translate this source brief into English? This will replace its current summary, not publish an article."))return;
    const label=button.textContent;button.disabled=true;button.textContent="Translating…";
    try {
      const {data}=await supabase.auth.getSession();
      const token=data?.session?.access_token;
      if(!token)throw Error("Sign in again to translate this article.");
      const response=await fetch("/.netlify/functions/curator-expand-article",{
        method:"POST",
        headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
        body:JSON.stringify({id,mode:"translate"})
      });
      const payload=await response.json().catch(()=>({}));
      if(!response.ok)throw Error(payload.error||"English translation failed.");
      window.appUI.toast("English translation saved as a source brief; review it before expansion.",{tone:"success"});
      await this.load();
    }catch(error){window.appUI.toast(error.message||"Translation failed.",{tone:"error"});}
    finally{button.disabled=false;button.textContent=label;}
  }

  async expandCuratorPost(curatorPostId, btn) {
    const post = this.posts.find(p => p.id === curatorPostId);
    if (!post) return;
    if (!await window.appUI.confirm("Create a longer AI-assisted article draft? This overwrites the existing source brief, but will NOT publish it. You'll still need to check the facts and review the writing.")) return;
    const label=btn.textContent;
    btn.disabled=true;btn.textContent="Writing draft…";
    try {
      const {data}=await supabase.auth.getSession();
      const token=data?.session?.access_token;
      if(!token) throw new Error("Sign in again to use the editorial assistant.");
      const res=await fetch("/.netlify/functions/curator-expand-article",{
        method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
        body:JSON.stringify({id:curatorPostId})
      });
      const payload=await res.json().catch(()=>({}));
      if(!res.ok)throw new Error(payload.error||"Could not expand the article.");
      const warnings=payload.verificationNotes||[];
      const note=this.container.querySelector('[data-editorial-state="'+curatorPostId+'"]');
      if(note)note.textContent="Expanded to "+payload.wordCount+" words. Fact-check before publication."+ (warnings.length ? " Check: "+warnings.slice(0,2).join("; ") : "");
      window.appUI.toast("AI-assisted article saved as a draft. Verify each factual claim and source before publishing.",{tone:"success"});
      await this.load();
    } catch(error) {
      window.appUI.toast(error?.message||"Editorial expansion failed.",{tone:"error"});
    } finally {
      btn.disabled=false;btn.textContent=label;
    }
  }

  async approveCuratorPost(curatorPostId, btn) {
    const curatorPost = this.posts.find(p => p.id === curatorPostId);
    if (!curatorPost) return;
    const imagesBox=this.container.querySelector('[data-curator-images="'+curatorPostId+'"]');
    const selectedImages=imageUrls(imagesBox?.value||"");
    const approved=this.container.querySelector('[data-curator-image-rights="'+curatorPostId+'"]')?.checked===true;
    const imageCredit=this.container.querySelector('[data-curator-image-credit="'+curatorPostId+'"]')?.value.trim()||"";
    if(selectedImages.length && (!approved || imageCredit.length<5)){
      window.appUI.toast("Verify image reuse rights and enter a meaningful attribution/permission reference before publishing.",{tone:"warning"});
      return;
    }
    const articleText = String(curatorPost.content || "").replace(/<[^>]*>/g, " ").replace(/&[^;]+;/g, " ");
    const articleWords = articleText.trim().split(/\s+/).filter(Boolean).length;
    if(articleWords<450 || articleText.includes("Editorial status:")){
      window.appUI.toast("This is a source brief, not an original article. Expand and fact-check it before publishing.",{tone:"warning"});
      return;
    }
    if (!await window.appUI.confirm(`Publish "${curatorPost.title}" to the site? Confirm that you checked the factual claims, editorial quality and source attribution.`)) return;

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Publishing...";

    try {
      const title = curatorPost.title || "Untitled";
      const body=curatorPost.content || (curatorPost.excerpt ? '<p>'+escapeHTML(curatorPost.excerpt)+'</p>' : "");
      const credit=selectedImages.length ? '<p class="curator-image-credit">Images: '+htmlEscape(imageCredit)+'</p>' : "";
      const content=body+credit;
      const now = new Date().toISOString();

      const result = await createPost({
        id: crypto.randomUUID(),
        title,
        slug: slugify(title),
        category_id: null,
        author_id: this.currentUser?.id || null,
        author_name: curatorPost.curator_sources?.name || curatorPost.source_name || "Content Curator Bot",
        created_at: now,
        updated_at: now,
        cover: selectedImages[0] || "",
        tags: curatorPost.tags || [],
        content,
        pinned: false,
        status: "published",
        publish_at: null,
        views: 0
      });

      if (result.error) throw result.error;
      const publishedId=result.data?.id;
      // A published post is never duplicated if attaching gallery media
      // fails. Staff can follow the published link and repair media manually.
      await markCuratorPostAsPosted(curatorPostId,publishedId);
      const failedMedia=publishedId
        ? await this.attachMissingGallery(publishedId,selectedImages.slice(1))
        : ["The published post ID was unavailable."];
      const postUrl=new URL("post.html?id="+encodeURIComponent(publishedId||""),window.location.href).toString();
      if(failedMedia.length) window.appUI.toast("Post published, but some gallery images failed. Repair gallery on "+postUrl,{tone:"error"});
      else window.appUI.toast("Article published. Social caption ready to share.",{tone:"success"});
      try{
        const caption=socialCaption(title,postUrl,(curatorPost.tags||[])[0]||"news");
        const use=await window.appUI.confirm("Copy a social sharing caption for this published article?");
        if(use)await navigator.clipboard.writeText(caption);
      }catch(e){console.warn("Social share caption unavailable",e);}
      await this.load();
    } catch (error) {
      window.appUI.toast(`Failed to publish: ${error.message}`);
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  async handleAddSource() {
    const name = this.container.querySelector("#sourceName").value;
    const url = this.container.querySelector("#sourceUrl").value;
    const sourceType = this.container.querySelector("#sourceType").value;
    const maxItems = this.container.querySelector("#sourceMaxItems").value;

    if (!name || !url) {
      window.appUI.toast("Please fill in required fields");
      return;
    }

    try {
      const isActive = await testCuratorSource(url);
      await createCuratorSource({
        name,
        feed_url: url,
        source_type: sourceType,
        max_items: maxItems,
        is_active: isActive
      });

      window.appUI.toast(isActive ? "✓ Source added and activated!" : "⚠️ Source added but couldn't connect. Check the URL.");
      this.resetSourceForm();
      await this.load();
    } catch (error) {
      window.appUI.toast(`Error: ${error.message}`);
    }
  }

  resetSourceForm() {
    this.container.querySelector("#addSourceForm").style.display = "none";
    this.container.querySelector("#sourceName").value = "";
    this.container.querySelector("#sourceUrl").value = "";
    this.container.querySelector("#sourceType").value = "rss";
    this.container.querySelector("#sourceMaxItems").value = "30";
  }

  async importRecommendedFeeds() {
    // Small curated list of high-quality tech feeds
    try {
      const module = await import("./recommended-feeds.js");
      const feeds = module.RECOMMENDED_FEEDS || [];
      for (const f of feeds) {
        const exists = (this.sources || []).some(s => s.feed_url === f.url);
        if (exists) continue;
        const isActive = await testCuratorSource(f.url);
        await createCuratorSource({
          name: f.name,
          feed_url: f.url,
          source_type: "rss",
          image_credit: f.name,
          is_active: isActive
        });
      }
    } catch (error) {
      throw error;
    }
  }
}

export default CuratorManager;
