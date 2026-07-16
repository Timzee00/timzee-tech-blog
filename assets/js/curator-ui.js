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
  markCuratorPostAsPosted,
  deleteCuratorPost,
  getCuratorStats,
  testCuratorSource,
  triggerScoutSync
} from "./curator.js";

import { getCurrentUserWithRole, getUserRole } from "./supabase.js";
import { escapeHTML, slugify } from "./utils.js";
import { createPost } from "./data.js";

class CuratorManager {
  constructor() {
    this.sources = [];
    this.posts = [];
    this.stats = null;
    this.currentUser = null;
  }

  async init(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    const user = await getCurrentUserWithRole();
    if (!user || !["admin", "super"].includes(getUserRole(user))) {
      this.container.innerHTML = "<p style='color: red;'>Access denied. Admin only.</p>";
      return;
    }
    this.currentUser = user;

    this.render();
    await this.load();
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
              <p style="font-size: 12px; color: #999;">Total active sources feeding content</p>
            </div>
            <div class="card">
              <h4>📰 Articles</h4>
              <div class="big-stat" id="articlesCount">0</div>
              <p style="font-size: 12px; color: #999;">Pending posts awaiting approval</p>
            </div>
            <div class="card">
              <h4>✓ Posted</h4>
              <div class="big-stat" id="postedCount">0</div>
              <p style="font-size: 12px; color: #999;">Articles published to site</p>
            </div>
            <div class="card">
              <h4>🔄 Last Sync</h4>
              <div style="padding: 16px 0;">
                <p id="lastSync" style="margin: 0; color: #666;">Never synced</p>
                <button class="btn btn-small" id="syncNowBtn">🔄 Sync Now</button>
              </div>
            </div>
          </div>
        </div>

        <!-- Sources Tab -->
        <div class="tab-content" data-tab="sources" style="display: none;">
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px;">
            <div>
              <h3>Content Sources</h3>
              <p style="color: #666; margin: 0;">RSS feeds and content sources for the bot to monitor</p>
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
            <div style="text-align: center; padding: 40px; color: #999;">Loading sources...</div>
          </div>
        </div>

        <!-- Posts Tab -->
        <div class="tab-content" data-tab="posts" style="display: none;">
          <div class="section-header">
            <h3>Articles Queue</h3>
            <p>Review and approve articles before posting</p>
          </div>
          <div id="postsList" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px;">
            <div style="grid-column: 1/-1; text-align: center; padding: 40px; color: #999;">Loading articles...</div>
          </div>
        </div>
      </div>

      <style>
        .curator-manager { margin: 20px 0; }
        .manager-header { display: grid; grid-template-columns: 1fr auto; gap: 30px; align-items: start; margin-bottom: 30px; }
        .stats-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
        .stat-card {
          background: linear-gradient(135deg, #0f766e, #14b8a6);
          color: white;
          padding: 16px;
          border-radius: 8px;
        }
        .stat-label { font-size: 12px; opacity: 0.9; }
        .stat-value { font-size: 24px; font-weight: 700; margin-top: 4px; }

        .curator-tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 2px solid #e2e8f0; }
        .tab-btn {
          padding: 12px 16px;
          border: none;
          background: transparent;
          cursor: pointer;
          font-size: 14px;
          font-weight: 600;
          color: #666;
          border-bottom: 3px solid transparent;
          transition: all 0.2s;
        }
        .tab-btn:hover { color: #333; }
        .tab-btn.active { color: #0f766e; border-bottom-color: #0f766e; }

        .dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; }
        .card { background: white; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; }
        .card h4 { margin: 0 0 12px 0; font-size: 14px; }
        .big-stat { font-size: 32px; font-weight: 700; color: #0f766e; }

        .form-card { background: #f9fafb; border: 1px solid #e2e8f0; border-radius: 8px; padding: 20px; }
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
        .section-header p { margin: 0; color: #666; font-size: 14px; }

        .source-item {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 12px;
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
        }
        .source-info h4 { margin: 0 0 4px 0; }
        .source-info p { margin: 2px 0; font-size: 12px; color: #666; }
        .source-actions { display: flex; gap: 8px; }

        .btn { padding: 8px 12px; border-radius: 6px; border: 1px solid #ddd; cursor: pointer; font-weight: 600; transition: all 0.2s; font-size: 12px; }
        .btn-small { padding: 6px 10px; font-size: 11px; }
        .btn-primary { background: #0f766e; color: white; border-color: #0f766e; }
        .btn-primary:hover { background: #0d5f5a; }
        .btn-ghost { background: white; color: #333; }
        .btn-ghost:hover { background: #f9fafb; }
        .btn-danger { background: #ef4444; color: white; border-color: #ef4444; }

        .post-card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .post-title { font-weight: 600; line-height: 1.4; }
        .post-meta { font-size: 12px; color: #999; }
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
        tabBtns.forEach(b => b.classList.remove("active"));
        tabContents.forEach(c => c.style.display = "none");
        btn.classList.add("active");
        this.container.querySelector(`[data-tab="${tab}"]`).style.display = "block";
      });
    });

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
          alert("Recommended feeds imported. Check the sources list.");
          await this.load();
        } catch (err) {
          console.error("Import failed:", err);
          alert("Import failed: " + (err.message || err));
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
      const errorCount = result.feedErrors ? result.feedErrors.length : 0;
      if (lastSync) {
        lastSync.textContent = `Synced ${new Date().toLocaleTimeString()} — ${count} new article${count === 1 ? "" : "s"}${errorCount ? `, ${errorCount} feed error${errorCount === 1 ? "" : "s"}` : ""}`;
      }
      await this.load();
    } catch (error) {
      if (lastSync) lastSync.textContent = `Sync failed: ${error.message}`;
      alert(`Sync failed: ${error.message}`);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  async load() {
    try {
      this.sources = await getAllCuratorSources();
      this.posts = await getUnpostedCuratorPosts(50);
      this.stats = await getCuratorStats();

      this.renderStats();
      this.renderSources();
      this.renderPosts();
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
      list.innerHTML = "<div style='text-align: center; padding: 40px; color: #999; grid-column: 1/-1;'>No sources configured. Add your first RSS feed!</div>";
      return;
    }

    list.innerHTML = this.sources.map(source => {
      const active = (typeof source.is_active !== "undefined") ? source.is_active : source.enabled;
      return `
      <div class="source-item">
        <div class="source-info">
          <h4>${escapeHTML(source.name || '')}</h4>
          <p>${escapeHTML(source.feed_url || source.query || 'No feed URL')}</p>
          <p style="font-size: 11px; color: #0f766e;">📡 ${escapeHTML(String(source.source_type || '').toUpperCase())} • 📄 Up to ${escapeHTML(String(source.max_items ?? 30))} articles per sync</p>
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
      list.innerHTML = "<div style='grid-column: 1/-1; text-align: center; padding: 40px; color: #999;'>No pending articles</div>";
      return;
    }

    list.innerHTML = this.posts.map(post => {
      const dateText = post.published_at ? new Date(post.published_at).toLocaleDateString() : "Unknown date";
      return `
      <div class="post-card">
        <div class="post-title">${escapeHTML(post.title || '')}</div>
        <div class="post-meta">
          Source: ${escapeHTML(post.curator_sources?.name || post.source_name || 'Unknown')} • ${escapeHTML(dateText)}
        </div>
        <p style="font-size: 13px; color: #666; margin: 0;">${escapeHTML(post.excerpt || 'No summary available')}</p>
        <div class="post-actions">
          <button class="btn btn-primary" data-post-id="${post.id}" data-type="post-approve">✓ Approve & Post</button>
          <button class="btn btn-ghost" data-post-id="${post.id}" data-type="post-delete">✕ Reject</button>
        </div>
      </div>
    `}).join("");

    list.querySelectorAll(".btn").forEach(btn => {
      btn.addEventListener("click", (e) => this.handlePostAction(e, btn));
    });
  }

  async handleSourceAction(e, btn) {
    const sourceId = btn.dataset.sourceId;
    const type = btn.dataset.type;

    if (type === "toggle-source") {
      const source = this.sources.find(s => s.id === sourceId);
      await toggleCuratorSourceStatus(sourceId, !source.is_active);
      await this.load();
    } else if (type === "delete-source") {
      if (confirm("Delete this source? This cannot be undone.")) {
        await deleteCuratorSource(sourceId);
        await this.load();
      }
    }
  }

  async handlePostAction(e, btn) {
    const postId = btn.dataset.postId;
    const type = btn.dataset.type;

    if (type === "post-approve") {
      await this.approveCuratorPost(postId, btn);
    } else if (type === "post-delete") {
      if (confirm("Reject this article?")) {
        await deleteCuratorPost(postId);
        await this.load();
      }
    }
  }

  async approveCuratorPost(curatorPostId, btn) {
    const curatorPost = this.posts.find(p => p.id === curatorPostId);
    if (!curatorPost) return;
    if (!confirm(`Publish "${curatorPost.title}" to the site?`)) return;

    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Publishing...";

    try {
      const title = curatorPost.title || "Untitled";
      const content = curatorPost.content
        || (curatorPost.excerpt ? `<p>${escapeHTML(curatorPost.excerpt)}</p>` : "");
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
        cover: curatorPost.image_url || "",
        tags: curatorPost.tags || [],
        content,
        pinned: false,
        status: "published",
        publish_at: null,
        views: 0
      });

      if (result.error) throw result.error;

      await markCuratorPostAsPosted(curatorPostId);
      await this.load();
    } catch (error) {
      alert(`Failed to publish: ${error.message}`);
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
      alert("Please fill in required fields");
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

      alert(isActive ? "✓ Source added and activated!" : "⚠️ Source added but couldn't connect. Check the URL.");
      this.resetSourceForm();
      await this.load();
    } catch (error) {
      alert(`Error: ${error.message}`);
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
