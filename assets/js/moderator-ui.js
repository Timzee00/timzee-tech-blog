/**
 * Professional Moderator Management UI
 * Easy-to-use interface for super admins to manage moderators and authors
 * Non-technical users can promote/demote with simple clicks
 */

import {
  getAllModerators,
  getAllAuthors,
  promoteToModerator,
  demoteModerator,
  toggleModeratorStatus,
  promoteToAuthor,
  demoteAuthor,
  toggleAuthorStatus,
  searchUsersForPromotion,
  getUserForPromotion
} from "./moderator.js";

import { getCurrentUser } from "./supabase.js";

class ModeratorManager {
  constructor() {
    this.moderators = [];
    this.authors = [];
    this.currentUser = null;
  }

  async init(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) return;

    this.currentUser = await getCurrentUser();
    if (!this.currentUser || this.currentUser.user_metadata?.role !== "super") {
      this.container.innerHTML = "<p style='color: red;'>Access denied. Super admin only.</p>";
      return;
    }

    this.render();
    await this.load();
  }

  render() {
    this.container.innerHTML = `
      <div class="moderator-manager">
        <div class="manager-tabs">
          <button class="tab-btn active" data-tab="moderators">
            👮 Team Moderators
          </button>
          <button class="tab-btn" data-tab="authors">
            ✍️ Content Authors
          </button>
          <button class="tab-btn" data-tab="promote">
            ⬆️ Promote User
          </button>
        </div>

        <!-- Moderators Tab -->
        <div class="tab-content" data-tab="moderators">
          <div class="section-header">
            <h3>Team Moderators</h3>
            <p>Team members who manage content and authors</p>
          </div>
          <div class="moderators-list" id="moderatorsList">
            <div style="text-align: center; padding: 20px; color: #999;">Loading...</div>
          </div>
        </div>

        <!-- Authors Tab -->
        <div class="tab-content" data-tab="authors" style="display: none;">
          <div class="section-header">
            <h3>Content Authors</h3>
            <p>Users with permission to create and publish posts</p>
          </div>
          <div class="authors-list" id="authorsList">
            <div style="text-align: center; padding: 20px; color: #999;">Loading...</div>
          </div>
        </div>

        <!-- Promote Tab -->
        <div class="tab-content" data-tab="promote" style="display: none;">
          <div class="section-header">
            <h3>Promote User</h3>
            <p>Search for a user to give them moderator or author permissions</p>
          </div>
          <div class="promote-panel">
            <div class="search-box">
              <input type="text" id="promoteSearch" placeholder="Search by username, name, or email...">
              <div class="search-results" id="promoteResults" style="display: none;"></div>
            </div>
            <div id="promoteForm" style="display: none; margin-top: 20px;">
              <div class="form-card">
                <div class="user-preview" id="userPreview"></div>
                <div style="margin-top: 16px;">
                  <label style="display: block; margin-bottom: 8px; font-weight: 600;">Promote as:</label>
                  <div style="display: flex; gap: 12px; margin-bottom: 16px;">
                    <label style="display: flex; align-items: center; gap: 8px;">
                      <input type="radio" name="promoteRole" value="moderator" checked>
                      <span>👮 Moderator</span>
                    </label>
                    <label style="display: flex; align-items: center; gap: 8px;">
                      <input type="radio" name="promoteRole" value="author">
                      <span>✍️ Author</span>
                    </label>
                  </div>
                </div>
                <div class="form-group">
                  <label>Notes (optional)</label>
                  <textarea id="promoteNotes" placeholder="Why promoting this user?" style="width: 100%; padding: 8px; border: 1px solid #ddd; border-radius: 6px; font-family: inherit; min-height: 60px;"></textarea>
                </div>
                <div style="display: flex; gap: 8px; margin-top: 16px;">
                  <button class="btn btn-primary" id="confirmPromote">✓ Confirm Promotion</button>
                  <button class="btn btn-ghost" id="cancelPromote">✕ Cancel</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <style>
        .moderator-manager { margin: 20px 0; }
        .manager-tabs { display: flex; gap: 8px; margin-bottom: 20px; border-bottom: 2px solid #e2e8f0; }
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
        .tab-btn.active {
          color: #0f766e;
          border-bottom-color: #0f766e;
        }
        .section-header { margin-bottom: 20px; }
        .section-header h3 { margin: 0 0 4px 0; }
        .section-header p { margin: 0; color: #666; font-size: 14px; }

        .user-card {
          background: white;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 12px;
          display: grid;
          grid-template-columns: 1fr auto;
          align-items: center;
          transition: all 0.2s;
        }
        .user-card:hover { box-shadow: 0 4px 12px rgba(0,0,0,0.08); }
        .user-info { display: flex; align-items: center; gap: 12px; }
        .user-avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: linear-gradient(135deg, #0f766e, #14b8a6);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-weight: 600;
        }
        .user-details h4 { margin: 0; font-size: 14px; }
        .user-details p { margin: 2px 0 0 0; font-size: 12px; color: #999; }
        .user-actions { display: flex; gap: 8px; }

        .btn { padding: 8px 12px; border-radius: 6px; border: 1px solid #ddd; cursor: pointer; font-weight: 600; transition: all 0.2s; font-size: 12px; }
        .btn-primary { background: #0f766e; color: white; border-color: #0f766e; }
        .btn-primary:hover { background: #0d5f5a; }
        .btn-ghost { background: white; color: #333; }
        .btn-ghost:hover { background: #f9fafb; }
        .btn-danger { background: #ef4444; color: white; border-color: #ef4444; }
        .btn-danger:hover { background: #dc2626; }
        .btn-toggle { background: #fbbf24; color: #111; border-color: #fbbf24; }
        .btn-toggle.off { background: #e5e7eb; color: #666; }

        .search-box { position: relative; }
        .search-box input {
          width: 100%;
          padding: 12px;
          border: 1px solid #ddd;
          border-radius: 8px;
          font-size: 14px;
          font-family: inherit;
        }
        .search-results {
          position: absolute;
          top: 100%;
          left: 0;
          right: 0;
          background: white;
          border: 1px solid #ddd;
          border-top: none;
          border-radius: 0 0 8px 8px;
          max-height: 300px;
          overflow-y: auto;
          z-index: 10;
        }
        .search-result {
          padding: 12px;
          border-bottom: 1px solid #f0f0f0;
          cursor: pointer;
          display: flex;
          align-items: center;
          gap: 12px;
        }
        .search-result:hover { background: #f9fafb; }

        .user-preview {
          background: #f9fafb;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 16px;
          display: flex;
          align-items: center;
          gap: 16px;
        }
        .user-preview-avatar {
          width: 48px;
          height: 48px;
          border-radius: 50%;
          background: linear-gradient(135deg, #0f766e, #14b8a6);
          display: flex;
          align-items: center;
          justify-content: center;
          color: white;
          font-size: 20px;
        }
        .user-preview-info h4 { margin: 0 0 4px 0; }
        .user-preview-info p { margin: 0; font-size: 12px; color: #666; }

        .form-group { margin-bottom: 12px; }
        .form-group label { display: block; font-weight: 600; margin-bottom: 6px; font-size: 14px; }
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

    // Search for promotion
    const searchInput = this.container.querySelector("#promoteSearch");
    if (searchInput) {
      searchInput.addEventListener("input", (e) => this.handlePromoteSearch(e.target.value));
    }
  }

  async load() {
    this.moderators = await getAllModerators();
    this.authors = await getAllAuthors();
    this.renderModerators();
    this.renderAuthors();
  }

  renderModerators() {
    const list = this.container.querySelector("#moderatorsList");
    if (!this.moderators.length) {
      list.innerHTML = "<div style='text-align: center; padding: 40px; color: #999;'>No moderators yet</div>";
      return;
    }

    list.innerHTML = this.moderators.map(mod => `
      <div class="user-card">
        <div class="user-info">
          <div class="user-avatar">${(mod.full_name || mod.username || "M").charAt(0).toUpperCase()}</div>
          <div class="user-details">
            <h4>${mod.full_name || mod.username}</h4>
            <p>${mod.email}</p>
            <p style="color: #0f766e; font-size: 11px;">Promoted ${new Date(mod.promoted_at).toLocaleDateString()}</p>
          </div>
        </div>
        <div class="user-actions">
          <button class="btn btn-toggle${mod.is_active ? "" : " off"}" data-user-id="${mod.user_id}" data-type="moderator-toggle">
            ${mod.is_active ? "🟢 Active" : "⚪ Inactive"}
          </button>
          <button class="btn btn-danger" data-user-id="${mod.user_id}" data-type="moderator-demote">
            ✕ Demote
          </button>
        </div>
      </div>
    `).join("");

    // Attach action buttons
    list.querySelectorAll(".btn").forEach(btn => {
      btn.addEventListener("click", (e) => this.handleModeratorAction(e, btn));
    });
  }

  renderAuthors() {
    const list = this.container.querySelector("#authorsList");
    if (!this.authors.length) {
      list.innerHTML = "<div style='text-align: center; padding: 40px; color: #999;'>No authors yet</div>";
      return;
    }

    list.innerHTML = this.authors.map(author => `
      <div class="user-card">
        <div class="user-info">
          <div class="user-avatar">${(author.full_name || author.username || "A").charAt(0).toUpperCase()}</div>
          <div class="user-details">
            <h4>${author.full_name || author.username}</h4>
            <p>${author.email}</p>
            <p style="color: #0f766e; font-size: 11px;">${author.post_count || 0} posts</p>
          </div>
        </div>
        <div class="user-actions">
          <button class="btn btn-toggle${author.is_active ? "" : " off"}" data-user-id="${author.user_id}" data-type="author-toggle">
            ${author.is_active ? "🟢 Active" : "⚪ Inactive"}
          </button>
          <button class="btn btn-danger" data-user-id="${author.user_id}" data-type="author-demote">
            ✕ Demote
          </button>
        </div>
      </div>
    `).join("");

    // Attach action buttons
    list.querySelectorAll(".btn").forEach(btn => {
      btn.addEventListener("click", (e) => this.handleAuthorAction(e, btn));
    });
  }

  async handleModeratorAction(e, btn) {
    const userId = btn.dataset.userId;
    const type = btn.dataset.type;

    if (type === "moderator-toggle") {
      const mod = this.moderators.find(m => m.user_id === userId);
      if (confirm(`${mod.is_active ? "Deactivate" : "Activate"} this moderator?`)) {
        await toggleModeratorStatus(userId, !mod.is_active);
        await this.load();
      }
    } else if (type === "moderator-demote") {
      const mod = this.moderators.find(m => m.user_id === userId);
      if (confirm(`Remove ${mod.full_name || mod.username} as moderator?`)) {
        await demoteModerator(userId);
        await this.load();
      }
    }
  }

  async handleAuthorAction(e, btn) {
    const userId = btn.dataset.userId;
    const type = btn.dataset.type;

    if (type === "author-toggle") {
      const author = this.authors.find(a => a.user_id === userId);
      if (confirm(`${author.is_active ? "Deactivate" : "Activate"} this author?`)) {
        await toggleAuthorStatus(userId, !author.is_active);
        await this.load();
      }
    } else if (type === "author-demote") {
      const author = this.authors.find(a => a.user_id === userId);
      if (confirm(`Remove ${author.full_name || author.username} as author?`)) {
        await demoteAuthor(userId);
        await this.load();
      }
    }
  }

  async handlePromoteSearch(query) {
    if (query.length < 2) {
      this.container.querySelector("#promoteResults").style.display = "none";
      return;
    }

    const results = await searchUsersForPromotion(query);
    const resultsDiv = this.container.querySelector("#promoteResults");

    if (!results.length) {
      resultsDiv.innerHTML = "<div style='padding: 12px; color: #999; text-align: center;'>No users found</div>";
      resultsDiv.style.display = "block";
      return;
    }

    resultsDiv.innerHTML = results.map(user => `
      <div class="search-result" data-user-id="${user.id}">
        <div style="width: 32px; height: 32px; border-radius: 50%; background: linear-gradient(135deg, #0f766e, #14b8a6); display: flex; align-items: center; justify-content: center; color: white; font-weight: 600;">
          ${(user.display_name || user.username || "U").charAt(0).toUpperCase()}
        </div>
        <div>
          <div style="font-weight: 600; font-size: 14px;">${user.display_name || user.username}</div>
          <div style="font-size: 12px; color: #999;">${user.email}</div>
        </div>
      </div>
    `).join("");
    resultsDiv.style.display = "block";

    // Handle result selection
    resultsDiv.querySelectorAll(".search-result").forEach(result => {
      result.addEventListener("click", async () => {
        const userId = result.dataset.userId;
        const user = results.find(u => u.id === userId);
        await this.showPromoteForm(user);
        resultsDiv.style.display = "none";
      });
    });
  }

  async showPromoteForm(user) {
    const form = this.container.querySelector("#promoteForm");
    const preview = this.container.querySelector("#userPreview");

    preview.innerHTML = `
      <div class="user-preview-avatar">${(user.display_name || user.username || "U").charAt(0).toUpperCase()}</div>
      <div class="user-preview-info">
        <h4>${user.display_name || user.username}</h4>
        <p>Email: ${user.email}</p>
        <p>Username: @${user.username}</p>
      </div>
    `;

    form.style.display = "block";
    form.scrollIntoView({ behavior: "smooth" });

    // Reset form
    this.container.querySelector('input[name="promoteRole"]').value = "moderator";
    this.container.querySelector("#promoteNotes").value = "";

    // Handle confirmation
    const confirmBtn = this.container.querySelector("#confirmPromote");
    const cancelBtn = this.container.querySelector("#cancelPromote");
    const searchInput = this.container.querySelector("#promoteSearch");

    confirmBtn.onclick = async () => {
      const role = this.container.querySelector('input[name="promoteRole"]:checked').value;
      const notes = this.container.querySelector("#promoteNotes").value;

      try {
        if (role === "moderator") {
          await promoteToModerator(user.id, {
            username: user.username,
            full_name: user.display_name,
            email: user.email,
            notes
          });
        } else {
          await promoteToAuthor(user.id, {
            username: user.username,
            full_name: user.display_name,
            email: user.email,
            avatar_url: user.avatar_url,
            notes
          });
        }

        alert(`✓ User promoted to ${role}!`);
        searchInput.value = "";
        form.style.display = "none";
        await this.load();
      } catch (error) {
        alert(`Error: ${error.message}`);
      }
    };

    cancelBtn.onclick = () => {
      form.style.display = "none";
      searchInput.value = "";
    };
  }
}

// Export for use in admin panels
export default ModeratorManager;
