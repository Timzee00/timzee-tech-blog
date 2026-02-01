import { login, requireRole, logout, getDisplayName, getUserRole, getSession } from "./auth.js";
import { supabase } from "./supabase.js";
import {
  fetchCategories,
  fetchPosts,
  fetchComments,
  fetchThemes,
  fetchAds,
  fetchContactRequests,
  fetchSupportRequests,
  fetchNewsletterSignups,
  fetchAdApplications,
  fetchAdminRequests,
  fetchContentRequests,
  fetchPostMedia,
  createCategory,
  createPost,
  createTheme,
  createPostMedia,
  createAd,
  updatePost,
  updateAd,
  updateContactRequestStatus,
  updateSupportRequestStatus,
  updateNewsletterSignupStatus,
  updateAdApplicationStatus,
  updateContentRequestStatus,
  incrementProfilePoints,
  deletePostMedia,
  deletePost,
  deleteAd,
  updateCommentStatus,
  deleteComment
} from "./data.js";
import { uploadMedia } from "./media.js";
import { bindRichEditorToolbar } from "./editor-tools.js";
import {
  formatDate,
  toTagArray,
  slugify,
  clampText,
  isSafeUrl,
  stripHTML,
  normalizeTags,
  escapeHTML
} from "./utils.js";
import { getPublishedFaqs, getAllFaqs, createFaq, updateFaq, deleteFaq } from "./faq.js";
import { getAllAuthors, promoteToAuthor, demoteAuthor, toggleAuthorStatus, searchUsersForPromotion } from "./moderator.js";

let editingPostId = null;
let coverPreviewUrl = "";
let coverFile = null;
let themeWallpaperFile = null;
let themeWallpaperPreviewUrl = "";
let adImageFile = null;
let adImagePreviewUrl = "";
let postMediaFiles = [];
let postMediaPreviewUrls = [];
let existingPostMedia = [];
const customCategoryValue = "__other__";
const emptyEditorHtml = "";

const categoryPalette = [
  "#0f766e",
  "#0ea5e9",
  "#f97316",
  "#16a34a",
  "#7c3aed",
  "#e11d48",
  "#0d9488"
];

const state = {
  categories: [],
  posts: [],
  comments: [],
  themes: [],
  ads: [],
  contactRequests: [],
  supportRequests: [],
  newsletterSignups: [],
  adApplications: [],
  adminRequests: [],
  contentRequests: [],
  user: null,
  users: [],
  userSearch: "",
  userPage: 1,
  userHasMore: false,
  userPerPage: 200
};

function pickCategoryColor() {
  return categoryPalette[Math.floor(Math.random() * categoryPalette.length)];
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function updateCoverPreview(src) {
  const preview = document.getElementById("coverPreview");
  if (!preview) return;
  if (!src) {
    preview.innerHTML = "Cover preview (optional)";
    return;
  }
  // Allow blob/data URLs from file inputs or safe external URLs
  if (src.startsWith('data:') || isSafeUrl(src)) {
    preview.innerHTML = `<img src="${escapeHTML(src)}" alt="cover preview">`;
  } else {
    preview.innerHTML = "<div style='color:#f00;'>Invalid preview URL</div>";
  }
}

function renderPostMediaPreview() {
  const preview = document.getElementById("postMediaPreview");
  if (!preview) return;
  const existingHtml = existingPostMedia
    .map((item) => {
      const media =
        item.media_type === "video"
          ? (isSafeUrl(item.url) ? `<video src="${escapeHTML(item.url)}" controls></video>` : '<div style="color:#f00;">Invalid media URL</div>')
          : (item.url && (item.url.startsWith('data:') || isSafeUrl(item.url)) ? `<img src="${escapeHTML(item.url)}" alt="post media">` : '<div style="color:#f00;">Invalid media URL</div>');
      return `
        <div class="media-card" data-kind="existing" data-id="${item.id}">
          ${media}
          <button class="btn ghost" type="button" data-action="remove-existing" data-id="${item.id}">
            Remove
          </button>
        </div>
      `;
    })
    .join("");

  const newHtml = postMediaFiles
    .map((file, index) => {
      const url = postMediaPreviewUrls[index];
      const isVideo = file.type?.startsWith("video");
      const media = isVideo
        ? (url && (url.startsWith('blob:') || isSafeUrl(url)) ? `<video src="${escapeHTML(url)}" controls></video>` : '<div style="color:#f00;">Invalid media</div>')
        : (url && (url.startsWith('blob:') || url.startsWith('data:') || isSafeUrl(url)) ? `<img src="${escapeHTML(url)}" alt="new media">` : '<div style="color:#f00;">Invalid media</div>');
      return `
        <div class="media-card" data-kind="new" data-index="${index}">
          ${media}
          <button class="btn ghost" type="button" data-action="remove-new" data-index="${index}">
            Remove
          </button>
        </div>
      `;
    })
    .join("");

  if (!existingHtml && !newHtml) {
    preview.innerHTML = "<div class=\"callout\">No gallery media yet.</div>";
    return;
  }

  preview.innerHTML = `${existingHtml}${newHtml}`;

  preview.querySelectorAll("button[data-action='remove-existing']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      await deletePostMedia(id);
      existingPostMedia = existingPostMedia.filter((item) => item.id !== id);
      renderPostMediaPreview();
    });
  });

  preview.querySelectorAll("button[data-action='remove-new']").forEach((btn) => {
    const index = Number(btn.dataset.index);
    btn.addEventListener("click", () => {
      if (!Number.isInteger(index)) return;
      postMediaFiles.splice(index, 1);
      const url = postMediaPreviewUrls.splice(index, 1)[0];
      if (url) URL.revokeObjectURL(url);
      renderPostMediaPreview();
    });
  });
}

function resetPostMediaSelections() {
  postMediaFiles = [];
  postMediaPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
  postMediaPreviewUrls = [];
  renderPostMediaPreview();
}

async function loadPostMedia(postId) {
  if (!postId) {
    existingPostMedia = [];
    renderPostMediaPreview();
    return;
  }
  existingPostMedia = await fetchPostMedia(postId);
  renderPostMediaPreview();
}

function updateThemeWallpaperPreview(src) {
  const preview = document.getElementById("themeWallpaperPreview");
  if (!preview) return;
  if (!src) {
    preview.innerHTML = "Wallpaper preview (optional)";
    return;
  }
  preview.innerHTML = isSafeUrl(src) ? `<img src="${escapeHTML(src)}" alt="theme wallpaper preview">` : '<div style="color:#f00;">Invalid wallpaper URL</div>';
}

function updateAdImagePreview(src) {
  const preview = document.getElementById("adImagePreview");
  if (!preview) return;
  if (!src) {
    preview.innerHTML = "Ad image preview (optional)";
    return;
  }
  preview.innerHTML = isSafeUrl(src) ? `<img src="${escapeHTML(src)}" alt="ad image preview">` : '<div style="color:#f00;">Invalid ad image URL</div>';
}

function setupImageInputs() {
  const coverInput = document.getElementById("postCoverFile");
  if (coverInput) {
    coverInput.addEventListener("change", async () => {
      const file = coverInput.files[0];
      if (!file) {
        coverFile = null;
        coverPreviewUrl = "";
        updateCoverPreview("");
        return;
      }
      coverFile = file;
      coverPreviewUrl = await readFileAsDataUrl(file);
      updateCoverPreview(coverPreviewUrl);
    });
  }

  const wallpaperInput = document.getElementById("themeWallpaper");
  if (wallpaperInput) {
    wallpaperInput.addEventListener("change", async () => {
      const file = wallpaperInput.files[0];
      if (!file) {
        themeWallpaperFile = null;
        themeWallpaperPreviewUrl = "";
        updateThemeWallpaperPreview("");
        return;
      }
      themeWallpaperFile = file;
      themeWallpaperPreviewUrl = await readFileAsDataUrl(file);
      updateThemeWallpaperPreview(themeWallpaperPreviewUrl);
    });
  }

  const adImageInput = document.getElementById("adImageFile");
  if (adImageInput) {
    adImageInput.addEventListener("change", async () => {
      const file = adImageInput.files[0];
      if (!file) {
        adImageFile = null;
        adImagePreviewUrl = "";
        updateAdImagePreview("");
        return;
      }
      adImageFile = file;
      adImagePreviewUrl = await readFileAsDataUrl(file);
      updateAdImagePreview(adImagePreviewUrl);
    });
  }

  const postMediaInput = document.getElementById("postMediaFiles");
  if (postMediaInput) {
    postMediaInput.addEventListener("change", () => {
      postMediaFiles = Array.from(postMediaInput.files || []);
      postMediaPreviewUrls.forEach((url) => URL.revokeObjectURL(url));
      postMediaPreviewUrls = postMediaFiles.map((file) => URL.createObjectURL(file));
      renderPostMediaPreview();
    });
  }

  const clearBtn = document.getElementById("clearPostMediaBtn");
  if (clearBtn) {
    clearBtn.addEventListener("click", async () => {
      if (editingPostId && existingPostMedia.length) {
        if (!confirm("Remove all gallery media for this post?")) return;
        await Promise.all(existingPostMedia.map((item) => deletePostMedia(item.id)));
        existingPostMedia = [];
      }
      resetPostMediaSelections();
    });
  }
}

function setupScheduleToggle() {
  const statusSelect = document.getElementById("postStatus");
  const publishInput = document.getElementById("postPublishAt");
  if (!statusSelect || !publishInput) return;
  const toggle = () => {
    publishInput.style.display = statusSelect.value === "scheduled" ? "block" : "none";
  };
  statusSelect.addEventListener("change", toggle);
  toggle();
}

function handleLogin() {
  const form = document.getElementById("adminLoginForm");
  if (!form) return false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();
    const message = document.getElementById("loginMessage");
    const result = await login(email, password, ["admin", "super"]);
    if (!result.ok) {
      message.textContent = result.message;
      return;
    }
    window.location.href = "dashboard.html";
  });
  return true;
}

function setupTabs() {
  const buttons = document.querySelectorAll(".admin-nav button");
  const panels = document.querySelectorAll("[data-panel]");
  console.log("setupTabs: found", buttons.length, "buttons and", panels.length, "panels");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      console.log("tab clicked:", button.dataset.tab);
      buttons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      panels.forEach((panel) => {
        panel.style.display = panel.dataset.panel === button.dataset.tab ? "block" : "none";
      });
    });
  });
}

async function setupAnnouncementForm() {
  const form = document.getElementById("announcementForm");
  const resetBtn = document.getElementById("resetAnnouncementBtn");
  if (!form) return;

  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      form.reset();
      document.getElementById("announcementPublishAt").value = "";
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = document.getElementById("announcementTitle").value.trim();
    const type = document.getElementById("announcementType").value;
    const message = document.getElementById("announcementMessage").value.trim();
    const status = document.getElementById("announcementStatus").value;
    const publishAt = document.getElementById("announcementPublishAt").value;

    if (!title || !type || !message) {
      alert("Please fill all required fields");
      return;
    }

    const payload = {
      id: crypto.randomUUID(),
      title,
      type,
      message,
      status,
      publish_at: publishAt ? new Date(publishAt).toISOString() : new Date().toISOString(),
      created_at: new Date().toISOString(),
      created_by: state.user.id
    };

    try {
      const result = await supabase.from("announcements").insert(payload);
      if (result.error) throw result.error;
      
      alert("Announcement published successfully!");
      form.reset();
      document.getElementById("announcementPublishAt").value = "";
      await renderAnnouncementsTable();
    } catch (error) {
      console.error("Announcement error:", error);
      alert("Failed to publish announcement: " + error.message);
    }
  });
}

async function renderAnnouncementsTable() {
  const table = document.getElementById("announcementsTable");
  if (!table) return;

  try {
    const result = await supabase
      .from("announcements")
      .select("*")
      .order("created_at", { ascending: false });
    
    const announcements = result.data || [];
    if (!announcements.length) {
      table.innerHTML = "<tr><td colspan='5' style='text-align:center; color:#999;'>No announcements yet</td></tr>";
      return;
    }

    table.innerHTML = announcements
      .map((ann) => `
        <tr>
          <td>${escapeHTML(ann.title)}</td>
          <td>${ann.type}</td>
          <td>${ann.status || "published"}</td>
          <td>${formatDate(ann.created_at)}</td>
          <td>
            <div class="inline-actions">
              <button class="muted" data-action="edit" data-id="${ann.id}">Edit</button>
              <button class="danger" data-action="delete" data-id="${ann.id}">Delete</button>
            </div>
          </td>
        </tr>
      `)
      .join("");

    table.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.action;
        const announcementId = btn.dataset.id;
        const announcement = announcements.find((a) => a.id === announcementId);
        if (!announcement) return;

        if (action === "delete") {
          if (!confirm("Delete this announcement?")) return;
          const result = await supabase.from("announcements").delete().eq("id", announcementId);
          if (result.error) {
            alert("Delete failed: " + result.error.message);
            return;
          }
          await renderAnnouncementsTable();
        }
      });
    });
  } catch (error) {
    console.error("Error loading announcements:", error);
    table.innerHTML = "<tr><td colspan='5' style='text-align:center; color:#f00;'>Error loading announcements</td></tr>";
  }
}

async function setupCuratorBot() {
  // Populate category select
  const categorySelect = document.getElementById("curatorSourceCategory");
  if (categorySelect && state.categories.length) {
    categorySelect.innerHTML = state.categories
      .map((cat) => `<option value="${cat.id}">${cat.name}</option>`)
      .join("");
  }

  // Setup source form
  const sourceForm = document.getElementById("curatorSourceForm");
  const resetCuratorBtn = document.getElementById("resetCuratorBtn");
  
  if (resetCuratorBtn) {
    resetCuratorBtn.addEventListener("click", () => {
      sourceForm.reset();
    });
  }

  if (sourceForm) {
    sourceForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const name = document.getElementById("curatorSourceName").value.trim();
      const url = document.getElementById("curatorSourceUrl").value.trim();
      const categoryId = document.getElementById("curatorSourceCategory").value;
      const description = document.getElementById("curatorSourceDescription").value.trim();

      if (!name || !url || !categoryId) {
        alert("Please fill all required fields");
        return;
      }

      const payload = {
        id: crypto.randomUUID(),
        name,
        feed_url: url,
        category_id: categoryId,
        description,
        is_active: true,
        created_at: new Date().toISOString(),
        created_by: state.user.id
      };

      try {
        const result = await supabase.from("curator_sources").insert(payload);
        if (result.error) throw result.error;
        
        alert("Feed source added successfully!");
        sourceForm.reset();
        await renderCuratorSources();
      } catch (error) {
        console.error("Curator source error:", error);
        alert("Failed to add source: " + error.message);
      }
    });
  }

  // Import recommended feeds (admin button)
  const importAdminBtn = document.getElementById("importFeedsAdminBtn");
  if (importAdminBtn) {
    importAdminBtn.addEventListener("click", async () => {
      if (!confirm("Import recommended tech RSS feeds? This will add multiple sources.")) return;
      importAdminBtn.disabled = true;
      importAdminBtn.textContent = "Importing...";
      try {
        const module = await import("./recommended-feeds.js");
        const feeds = module.RECOMMENDED_FEEDS || [];
        for (const f of feeds) {
          // Skip duplicate URLs (check both 'feed_url' and 'url' columns)
          const existing = await supabase.from("curator_sources").select("id").or(`feed_url.eq.${f.url},url.eq.${f.url}`).maybeSingle();
          if (existing && existing.data) continue;
          const payload = {
            id: crypto.randomUUID(),
            name: f.name,
            feed_url: f.url,
            url: f.url,
            category_id: state.categories.length ? state.categories[0].id : null,
            description: f.description,
            is_active: true,
            created_at: new Date().toISOString(),
            created_by: state.user.id
          };
          await supabase.from("curator_sources").insert(payload);
        }
        alert("Recommended feeds imported. Refreshing list.");
        await renderCuratorSources();
      } catch (error) {
        console.error("Import feeds failed:", error);
        alert("Import failed: " + (error.message || error));
      } finally {
        importAdminBtn.disabled = false;
        importAdminBtn.textContent = "Import Recommended Feeds";
      }
    });
  }

  // Setup bot settings form (load and update the actual settings row)
  const settingsForm = document.getElementById("botSettingsForm");
  if (settingsForm) {
    // Load existing settings and populate the form
    try {
      const settingsRow = await supabase.from("curator_settings").select("*").maybeSingle();
      const s = settingsRow.data || null;
      if (s) {
        // populate only fields that exist in row
        if (typeof s.auto_post !== "undefined") document.getElementById("botAutoPublish").checked = !!s.auto_post;
        if (typeof s.max_posts_per_day !== "undefined") document.getElementById("botMaxPostsPerDay").value = s.max_posts_per_day;
        // store id for updates
        settingsForm.dataset.settingsId = s.id;
      }
    } catch (error) {
      console.error("Could not load bot settings:", error);
    }

    settingsForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const updates = {};
      const settingsId = settingsForm.dataset.settingsId;

      // Only include fields that exist on the saved settings row to avoid unknown column errors
      if (document.getElementById("botAutoPublish")) updates.auto_post = document.getElementById("botAutoPublish").checked;
      if (document.getElementById("botMaxPostsPerDay")) updates.max_posts_per_day = parseInt(document.getElementById("botMaxPostsPerDay").value) || 5;

      try {
        let result;
        if (settingsId) {
          result = await supabase.from("curator_settings").update(updates).eq("id", settingsId);
        } else {
          // insert a new row if none exists
          result = await supabase.from("curator_settings").insert(updates);
        }
        if (result.error) throw result.error;
        alert("Bot settings saved successfully!");
      } catch (error) {
        console.error("Settings error:", error);
        alert("Failed to save settings: " + (error.message || error));
      }
    });
  }

  await renderCuratorSources();
}

async function renderCuratorSources() {
  const table = document.getElementById("curatorSourcesTable");
  if (!table) return;

  try {
    const result = await supabase
      .from("curator_sources")
      .select("*")
      .order("created_at", { ascending: false });
    
    const sources = result.data || [];
    if (!sources.length) {
      table.innerHTML = "<tr><td colspan='5' style='text-align:center; color:#999;'>No feed sources yet</td></tr>";
      return;
    }

    table.innerHTML = sources
      .map((source) => {
        const category = state.categories.find((cat) => cat.id === source.category_id);
        return `
          <tr>
            <td>${escapeHTML(source.name)}</td>
            <td>${category ? category.name : "Unknown"}</td>
            <td><small>${(source.feed_url || source.url || "").substring(0, 40)}...</small></td>
            <td>${source.is_active ? "🟢 Active" : "⚪ Inactive"}</td>
            <td>
              <div class="inline-actions">
                <button class="muted" data-action="toggle" data-id="${source.id}">
                  ${source.is_active ? "Pause" : "Resume"}
                </button>
                <button class="danger" data-action="delete" data-id="${source.id}">Delete</button>
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    table.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const action = btn.dataset.action;
        const sourceId = btn.dataset.id;
        const source = sources.find((s) => s.id === sourceId);
        if (!source) return;

        if (action === "toggle") {
          const result = await supabase
            .from("curator_sources")
            .update({ is_active: !source.is_active })
            .eq("id", sourceId);
          if (result.error) {
            alert("Update failed: " + result.error.message);
            return;
          }
          await renderCuratorSources();
        }

        if (action === "delete") {
          if (!confirm("Delete this feed source?")) return;
          const result = await supabase.from("curator_sources").delete().eq("id", sourceId);
          if (result.error) {
            alert("Delete failed: " + result.error.message);
            return;
          }
          await renderCuratorSources();
        }
      });
    });
  } catch (error) {
    console.error("Error loading curator sources:", error);
    table.innerHTML = "<tr><td colspan='5' style='text-align:center; color:#f00;'>Error loading sources</td></tr>";
  }
}

async function setupFaq() {
  const faqForm = document.getElementById("faqForm");
  const faqTable = document.getElementById("faqTable");

  // Authors manager for admins
  async function setupAuthors() {
    const searchInput = document.getElementById('authorSearchInput');
    const searchBtn = document.getElementById('authorSearchBtn');
    const resultsDiv = document.getElementById('authorSearchResults');
    const authorsTable = document.getElementById('authorsTable');

    const renderAuthors = async () => {
      try {
        const authors = await getAllAuthors();
        if (!authors.length) {
          authorsTable.innerHTML = "<tr><td colspan='5' style='text-align:center; color:#999;'>No authors yet</td></tr>";
          return;
        }
        authorsTable.innerHTML = authors.map(a => `
          <tr>
            <td>${escapeHTML(a.full_name || a.username)}</td>
            <td>${escapeHTML(a.email)}</td>
            <td>${a.post_count || 0}</td>
            <td>${a.is_active ? 'Yes' : 'No'}</td>
            <td>
              <div class="inline-actions">
                <button class="muted" data-action="toggle" data-id="${a.user_id}">${a.is_active ? 'Deactivate' : 'Activate'}</button>
                <button class="danger" data-action="demote" data-id="${a.user_id}">Demote</button>
              </div>
            </td>
          </tr>
        `).join('');

        authorsTable.querySelectorAll('button').forEach(btn => {
          btn.addEventListener('click', async () => {
            const action = btn.dataset.action;
            const id = btn.dataset.id;
            if (action === 'toggle') {
              if (!confirm('Continue?')) return;
              await toggleAuthorStatus(id, !authors.find(x => x.user_id === id).is_active);
              await renderAuthors();
            } else if (action === 'demote') {
              if (!confirm('Remove author privileges?')) return;
              await demoteAuthor(id);
              await renderAuthors();
            }
          });
        });
      } catch (err) {
        console.error('Error loading authors', err);
        authorsTable.innerHTML = "<tr><td colspan='5' style='text-align:center; color:#f00;'>Error loading authors</td></tr>";
      }
    };

    if (searchBtn && searchInput) {
      searchBtn.addEventListener('click', async () => {
        const q = searchInput.value.trim();
        if (!q) return;
        try {
          const users = await searchUsersForPromotion(q);
          if (!users.length) {
            resultsDiv.innerHTML = '<div style="padding:12px; color:#999;">No users found</div>';
            resultsDiv.style.display = 'block';
            return;
          }
          resultsDiv.innerHTML = users.map(u => `
            <div style="padding:8px; border:1px solid #eee; margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">
              <div>
                <strong>${escapeHTML(u.display_name || u.username)}</strong><br><small style="color:#666;">${escapeHTML(u.email)}</small>
              </div>
              <div>
                <button class="btn" data-id="${u.id}" data-action="promote">Promote to Author</button>
              </div>
            </div>
          `).join('');
          resultsDiv.style.display = 'block';

          resultsDiv.querySelectorAll('button').forEach(b => {
            b.addEventListener('click', async () => {
              const id = b.dataset.id;
              try {
                const user = users.find(u => u.id === id) || {};
                await promoteToAuthor(id, {
                  username: user.username || '',
                  full_name: user.display_name || user.username || '',
                  email: user.email || '',
                  avatar_url: user.avatar_url || ''
                });
                alert('User promoted to author');
                resultsDiv.style.display = 'none';
                searchInput.value = '';
                await renderAuthors();
              } catch (err) {
                alert('Promotion failed: ' + (err.message || err));
              }
            });
          });

        } catch (err) {
          console.error('Search error', err);
          resultsDiv.innerHTML = '<div style="padding:12px; color:#f00;">Search failed</div>';
          resultsDiv.style.display = 'block';
        }
      });
    }

    await renderAuthors();
  }



  const renderFaqs = async () => {
    try {
      const faqs = await getAllFaqs();
      if (!faqs.length) {
        faqTable.innerHTML = "<tr><td colspan='4' style='text-align:center; color:#999;'>No FAQs yet</td></tr>";
        return;
      }
      faqTable.innerHTML = faqs.map(f => `
        <tr>
          <td>${escapeHTML(f.question)}</td>
          <td>${escapeHTML(f.category || '')}</td>
          <td>${f.is_published ? 'Yes' : 'No'}</td>
          <td>
            <div class="inline-actions">
              <button class="muted" data-action="edit" data-id="${f.id}">Edit</button>
              <button class="danger" data-action="delete" data-id="${f.id}">Delete</button>
            </div>
          </td>
        </tr>
      `).join("");

      faqTable.querySelectorAll("button").forEach(btn => {
        btn.addEventListener("click", async () => {
          const action = btn.dataset.action;
          const id = btn.dataset.id;
          const item = faqs.find(x => x.id === id);
          if (action === 'edit') {
            document.getElementById('faqId').value = item.id;
            document.getElementById('faqQuestion').value = item.question;
            document.getElementById('faqAnswer').value = item.answer;
            document.getElementById('faqCategory').value = item.category || '';
            document.getElementById('faqPublished').checked = !!item.is_published;
            window.scrollTo({ top: 0, behavior: 'smooth' });
          } else if (action === 'delete') {
            if (!confirm('Delete this FAQ?')) return;
            await deleteFaq(id);
            await renderFaqs();
            alert('FAQ deleted');
          }
        });
      });
    } catch (err) {
      console.error('Error loading faqs', err);
      faqTable.innerHTML = "<tr><td colspan='4' style='text-align:center; color:#f00;'>Error loading FAQs</td></tr>";
    }
  };

  if (faqForm) {
    faqForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const id = document.getElementById('faqId').value || null;
      const question = document.getElementById('faqQuestion').value.trim();
      const answer = document.getElementById('faqAnswer').value.trim();
      const category = document.getElementById('faqCategory').value.trim();
      const is_published = document.getElementById('faqPublished').checked;
      if (!question || !answer) { alert('Please fill question and answer'); return; }
      try {
        if (id) {
          await updateFaq(id, { question, answer, category, is_published });
          alert('FAQ updated');
        } else {
          await createFaq({ question, answer, category, is_published });
          alert('FAQ created');
        }
        faqForm.reset();
        await renderFaqs();
      } catch (err) {
        console.error('FAQ save error', err);
        alert('Failed to save FAQ: ' + (err.message || err));
      }
    });

    const resetBtn = document.getElementById('faqResetBtn');
    if (resetBtn) resetBtn.addEventListener('click', () => faqForm.reset());
  }

  await renderFaqs();
  // Also initialize authors manager (admin-level)
  try {
    await setupAuthors();
  } catch (err) {
    console.error('Authors manager failed to initialize:', err);
  }
}

function populateCategories() {
  const select = document.getElementById("postCategory");
  if (!select) return;
  select.innerHTML = state.categories
    .map((cat) => `<option value="${cat.id}">${cat.name}</option>`)
    .join("");
  select.insertAdjacentHTML(
    "beforeend",
    `<option value="${customCategoryValue}">Others (custom)</option>`
  );
  const customWrap = document.getElementById("customCategoryWrap");
  const toggleCustom = () => {
    if (!customWrap) return;
    customWrap.classList.toggle("hidden", select.value !== customCategoryValue);
  };
  select.onchange = toggleCustom;
  toggleCustom();
}

function resetForm() {
  editingPostId = null;
  coverPreviewUrl = "";
  coverFile = null;
  existingPostMedia = [];
  resetPostMediaSelections();
  document.getElementById("postForm").reset();
  const editor = document.getElementById("postEditor");
  if (editor) editor.innerHTML = emptyEditorHtml;
  document.getElementById("postFormHint").textContent = "";
  document.getElementById("savePostBtn").textContent = "Publish";
  updateCoverPreview("");
  const customWrap = document.getElementById("customCategoryWrap");
  if (customWrap) customWrap.classList.add("hidden");
  const statusSelect = document.getElementById("postStatus");
  if (statusSelect) statusSelect.dispatchEvent(new Event("change"));
  const reviewPane = document.getElementById("postReview");
  if (reviewPane) reviewPane.classList.add("hidden");
}

function setupPostReview() {
  const reviewBtn = document.getElementById("reviewPostBtn");
  const reviewPane = document.getElementById("postReview");
  const closeBtn = document.getElementById("closeReviewBtn");
  if (!reviewBtn || !reviewPane) return;

  const renderReview = () => {
    const title = document.getElementById("postTitle").value.trim();
    const categorySelect = document.getElementById("postCategory");
    let categoryLabel = categorySelect?.selectedOptions?.[0]?.textContent || "Category";
    if (categorySelect?.value === customCategoryValue) {
      const customName = document.getElementById("customCategory")?.value.trim();
      if (customName) categoryLabel = customName;
    }
    const tags = document.getElementById("postTags").value.trim();
    const coverUrl = document.getElementById("postCover").value.trim();
    const editor = document.getElementById("postEditor");
    const raw = editor?.innerHTML?.trim() || "";
    const content = window.normalizeHtml ? window.normalizeHtml(raw) : raw;

    document.getElementById("reviewTitle").textContent = title || "Untitled post";
    document.getElementById("reviewCategory").textContent = categoryLabel;
    document.getElementById("reviewTags").textContent = tags ? `Tags: ${tags}` : "";
    const cover = document.getElementById("reviewCover");
    if (cover) {
      const src = coverFile ? coverPreviewUrl : coverUrl;
      cover.innerHTML = src && isSafeUrl(src) ? `<img src="${escapeHTML(src)}" alt="Cover preview">` : "";
    }
    const reviewContent = document.getElementById("reviewContent");
    if (reviewContent) reviewContent.innerHTML = content || "<p>No content yet.</p>";
  };

  reviewBtn.addEventListener("click", () => {
    renderReview();
    reviewPane.classList.remove("hidden");
    reviewPane.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      reviewPane.classList.add("hidden");
    });
  }
}

function handlePostForm() {
  const form = document.getElementById("postForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = document.getElementById("postTitle").value.trim();
    const categorySelect = document.getElementById("postCategory");
    let categoryId = categorySelect.value;
    const tags = toTagArray(document.getElementById("postTags").value);
    const status = document.getElementById("postStatus").value || "published";
    const publishAtRaw = document.getElementById("postPublishAt").value;
    const publishAt = publishAtRaw ? new Date(publishAtRaw).toISOString() : null;
    const cover = document.getElementById("postCover").value.trim();
    const editor = document.getElementById("postEditor");
    const contentRaw = editor?.innerHTML?.trim() || "";
    const contentText = editor?.innerText?.trim() || "";
    const content = window.normalizeHtml ? window.normalizeHtml(contentRaw) : contentRaw;

    if (categoryId === customCategoryValue) {
      const customInput = document.getElementById("customCategory");
      const customName = customInput.value.trim();
      if (!customName) {
        document.getElementById("postFormHint").textContent = "Please enter a custom category name.";
        return;
      }
      let customCategory = state.categories.find(
        (cat) => cat.name.toLowerCase() === customName.toLowerCase()
      );
      if (!customCategory) {
        const created = await createCategory({
          name: customName,
          description: "Custom category",
          color: pickCategoryColor()
        });
        if (created.error) {
          document.getElementById("postFormHint").textContent = "Failed to create category.";
          return;
        }
        customCategory = created.data;
        state.categories.push(customCategory);
      }
      categoryId = customCategory.id;
      populateCategories();
      document.getElementById("postCategory").value = categoryId;
      const customWrap = document.getElementById("customCategoryWrap");
      if (customWrap) customWrap.classList.add("hidden");
    }

    if (!title || !contentText) return;
    if (status === "scheduled" && !publishAt) {
      document.getElementById("postFormHint").textContent = "Add a publish date for scheduled posts.";
      return;
    }

    const now = new Date().toISOString();
    let uploadedCover = "";
    if (coverFile) {
      uploadedCover = await uploadMedia(coverFile, "covers");
    }

    let savedPostId = editingPostId;
    let saveError = null;

    if (editingPostId) {
      const result = await updatePost(editingPostId, {
        cover: uploadedCover || cover || state.posts.find((item) => item.id === editingPostId)?.cover || "",
        title,
        slug: slugify(title),
        category_id: categoryId,
        tags,
        content,
        status,
        publish_at: status === "scheduled" ? publishAt : null,
        updated_at: now
      });
      saveError = result.error;
      document.getElementById("postFormHint").textContent = result.error
        ? "Update failed."
        : "Post updated.";
    } else {
      const result = await createPost({
        id: crypto.randomUUID(),
        title,
        slug: slugify(title),
        category_id: categoryId,
        author_id: state.user.id,
        author_name: getDisplayName(state.user),
        created_at: now,
        updated_at: now,
        cover: uploadedCover || cover || "",
        tags,
        content,
        pinned: false,
        status,
        publish_at: status === "scheduled" ? publishAt : null,
        views: 0
      });
      saveError = result.error;
      savedPostId = result.data?.id || savedPostId;
      document.getElementById("postFormHint").textContent = result.error
        ? "Publish failed."
        : "Post published.";
      if (!result.error && state.user) {
        await incrementProfilePoints(state.user.id, 10);
      }
    }

    if (!saveError && savedPostId && postMediaFiles.length) {
      const orderStart = existingPostMedia.length;
      for (let index = 0; index < postMediaFiles.length; index += 1) {
        const file = postMediaFiles[index];
        const uploadedUrl = await uploadMedia(file, "post-media");
        if (!uploadedUrl) continue;
        const mediaType = file.type?.startsWith("video") ? "video" : "image";
        await createPostMedia({
          id: crypto.randomUUID(),
          post_id: savedPostId,
          url: uploadedUrl,
          media_type: mediaType,
          sort_order: orderStart + index,
          created_at: new Date().toISOString()
        });
      }
      resetPostMediaSelections();
      await loadPostMedia(savedPostId);
    }

    await refreshData();
    renderPostsTable();
    resetForm();
  });

  document.getElementById("resetFormBtn").addEventListener("click", resetForm);
}

function renderPostsTable() {
  const table = document.getElementById("postsTable");
  if (!table) return;
  table.innerHTML = state.posts
    .map((post) => {
      const category = state.categories.find((cat) => cat.id === post.category_id);
      return `
        <tr>
          <td>${clampText(post.title || "", 40)}</td>
          <td>${category ? category.name : ""}</td>
          <td>${post.status || "published"}</td>
          <td>${formatDate(post.updated_at)}</td>
          <td>
            <div class="inline-actions">
              <button class="muted" data-action="edit" data-id="${post.id}">Edit</button>
              <button class="muted" data-action="pin" data-id="${post.id}">${post.pinned ? "Unpopular" : "Popular"}</button>
              <button class="danger" data-action="delete" data-id="${post.id}">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  table.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;
      const post = state.posts.find((item) => item.id === btn.dataset.id);
      if (!post) return;
      if (action === "edit") {
        editingPostId = post.id;
        document.getElementById("postTitle").value = post.title;
        const categorySelect = document.getElementById("postCategory");
        if (state.categories.some((cat) => cat.id === post.category_id)) {
          categorySelect.value = post.category_id;
          document.getElementById("customCategoryWrap").classList.add("hidden");
          document.getElementById("customCategory").value = "";
        } else {
          categorySelect.value = customCategoryValue;
          document.getElementById("customCategoryWrap").classList.remove("hidden");
          document.getElementById("customCategory").value = "";
        }
        document.getElementById("postTags").value = normalizeTags(post.tags).join(", ");
        document.getElementById("postStatus").value = post.status || "published";
        document.getElementById("postPublishAt").value = toLocalDateTimeValue(post.publish_at);
        document.getElementById("postStatus").dispatchEvent(new Event("change"));
        const coverInput = document.getElementById("postCover");
        coverInput.value = post.cover || "";
        coverFile = null;
        coverPreviewUrl = post.cover || "";
        updateCoverPreview(coverPreviewUrl);
        const editor = document.getElementById("postEditor");
        if (editor) editor.innerHTML = window.normalizeHtml ? window.normalizeHtml(post.content || "") : (post.content || "");
        document.getElementById("savePostBtn").textContent = "Update";
        document.getElementById("postFormHint").textContent = "Editing post.";
        resetPostMediaSelections();
        await loadPostMedia(post.id);
      }
      if (action === "pin") {
        await updatePost(post.id, { pinned: !post.pinned });
        await refreshData();
        renderPostsTable();
      }
      if (action === "delete") {
        if (!confirm("Delete this post?")) return;
        await deletePost(post.id);
        await refreshData();
        renderPostsTable();
      }
    });
  });
}

function renderCommentsTable() {
  const table = document.getElementById("commentsTable");
  if (!table) return;
  table.innerHTML = state.comments
    .map((comment) => {
      const post = state.posts.find((item) => item.id === comment.post_id);
      return `
        <tr>
          <td>${post ? clampText(post.title || "", 40) : ""}</td>
          <td>${comment.author_name}</td>
          <td>${clampText(stripHTML(comment.body || ""), 60)}</td>
          <td>${comment.status}</td>
          <td>
            <div class="inline-actions">
              <button class="muted" data-action="approve" data-id="${comment.id}">Approve</button>
              <button class="danger" data-action="delete" data-id="${comment.id}">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  table.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const comment = state.comments.find((item) => item.id === btn.dataset.id);
      if (!comment) return;
      if (btn.dataset.action === "approve") {
        await updateCommentStatus(comment.id, "approved");
      }
      if (btn.dataset.action === "delete") {
        await deleteComment(comment.id);
      }
      await refreshData();
      renderCommentsTable();
    });
  });
}

function toLocalDateTimeValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

async function fetchUsers({ search = "", page = 1, perPage = state.userPerPage } = {}) {
  const session = await getSession();
  const token = session?.access_token;
  if (!token) return { error: "Auth token missing." };
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  params.set("perPage", perPage);
  if (!search) params.set("page", String(page));
  const query = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`/.netlify/functions/list-users${query}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const result = await response.json();
  if (!response.ok) {
    return { error: result.error || "Failed to load users." };
  }
  return { data: result.users || [], page: result.page || page, hasMore: !!result.hasMore };
}

async function updateUserAction(userId, action, tier) {
  const session = await getSession();
  const token = session?.access_token;
  if (!token) return { error: "Auth token missing." };
  const response = await fetch("/.netlify/functions/update-user", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ userId, action, verificationTier: tier })
  });
  const result = await response.json();
  if (!response.ok) {
    return { error: result.error || "User update failed." };
  }
  return { data: result.profile || null };
}

function renderUsersTable(users) {
  const table = document.getElementById("usersTable");
  if (!table) return;
  if (!users.length) {
    table.innerHTML = `
      <tr>
        <td colspan="7">No users found.</td>
      </tr>
    `;
    return;
  }
  const tierOptions = ["standard", "pro", "elite"];
  table.innerHTML = users
    .map((user) => {
      const displayName =
        user.display_name || user.email?.split("@")[0] || "Member";
      const safeName = escapeHTML(displayName);
      const safeEmail = escapeHTML(user.email || "");
      const status = user.account_status || "active";
      const statusClass = status === "suspended" ? "status-pill suspended" : "status-pill";
      const verifiedLabel = user.is_verified ? "Verified" : "Standard";
      const tier = user.verification_tier || "standard";
      return `
        <tr>
          <td>${safeName}</td>
          <td>${safeEmail}</td>
          <td><span class="${statusClass}">${escapeHTML(status)}</span></td>
          <td>${escapeHTML(verifiedLabel)}</td>
          <td>
            <select data-action="tier" data-id="${user.id}">
              ${tierOptions
                .map(
                  (option) =>
                    `<option value="${option}" ${
                      option === tier ? "selected" : ""
                    }>${option}</option>`
                )
                .join("")}
            </select>
          </td>
          <td>${user.created_at ? new Date(user.created_at).toLocaleDateString() : "—"}</td>
          <td>
            <div class="inline-actions">
              <button class="muted" data-action="${user.is_verified ? "unverify" : "verify"}" data-id="${
                user.id
              }">${user.is_verified ? "Unverify" : "Verify"}</button>
              <button class="danger" data-action="${status === "suspended" ? "activate" : "suspend"}" data-id="${
                user.id
              }">${status === "suspended" ? "Activate" : "Suspend"}</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  table.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;
      const userId = btn.dataset.id;
      if (!userId || !action) return;
      if (action === "suspend" && !confirm("Suspend this account?")) return;
      if (action === "activate" && !confirm("Reactivate this account?")) return;
      const result = await updateUserAction(userId, action);
      if (result.error) {
        alert(result.error);
        return;
      }
      await loadUsers(state.userSearch);
    });
  });

  table.querySelectorAll("select[data-action='tier']").forEach((select) => {
    select.addEventListener("change", async () => {
      const userId = select.dataset.id;
      if (!userId) return;
      const tier = select.value;
      const result = await updateUserAction(userId, "set_tier", tier);
      if (result.error) {
        alert(result.error);
        return;
      }
      await loadUsers(state.userSearch);
    });
  });
}

function updateUserPager() {
  const prevBtn = document.getElementById("userPrevBtn");
  const nextBtn = document.getElementById("userNextBtn");
  const info = document.getElementById("userPageInfo");
  if (!prevBtn || !nextBtn || !info) return;
  if (state.userSearch) {
    info.textContent = "Search results";
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }
  info.textContent = `Page ${state.userPage}`;
  prevBtn.disabled = state.userPage <= 1;
  nextBtn.disabled = !state.userHasMore;
}

async function loadUsers(search = "", page = 1) {
  const hint = document.getElementById("usersHint");
  if (hint) hint.textContent = "Loading users...";
  const nextPage = search ? 1 : page;
  const result = await fetchUsers({ search, page: nextPage });
  if (result.error) {
    if (hint) hint.textContent = result.error;
    renderUsersTable([]);
    return;
  }
  state.users = result.data;
  state.userPage = result.page || nextPage;
  state.userHasMore = !!result.hasMore;
  if (hint) {
    hint.textContent = `Showing ${state.users.length} user${state.users.length === 1 ? "" : "s"}.`;
  }
  renderUsersTable(state.users);
  updateUserPager();
}

function setupUsersPanel() {
  const input = document.getElementById("userSearchInput");
  const searchBtn = document.getElementById("userSearchBtn");
  const clearBtn = document.getElementById("userClearBtn");
  const prevBtn = document.getElementById("userPrevBtn");
  const nextBtn = document.getElementById("userNextBtn");
  if (searchBtn) {
    searchBtn.addEventListener("click", () => {
      state.userSearch = input?.value.trim() || "";
      state.userPage = 1;
      loadUsers(state.userSearch, 1);
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (input) input.value = "";
      state.userSearch = "";
      state.userPage = 1;
      loadUsers("", 1);
    });
  }
  if (input) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        state.userSearch = input.value.trim();
        state.userPage = 1;
        loadUsers(state.userSearch, 1);
      }
    });
  }
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (state.userSearch) return;
      const next = Math.max(1, state.userPage - 1);
      loadUsers("", next);
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      if (state.userSearch || !state.userHasMore) return;
      loadUsers("", state.userPage + 1);
    });
  }
  loadUsers("", 1);
}

function renderThemes() {
  const list = document.getElementById("themeList");
  if (!list) return;
  if (!state.themes.length) {
    list.innerHTML = "<div class=\"callout\">No themes yet.</div>";
    return;
  }
  list.innerHTML = state.themes
    .map(
      (theme) => `
        <div class="theme-card">
          <div class="theme-sample" style="${
            theme.wallpaper_url
              ? `background-image: linear-gradient(135deg, rgba(15,23,42,0.35), rgba(15,23,42,0.15)), url('${theme.wallpaper_url}'); background-size: cover; background-position: center;`
              : `background: linear-gradient(135deg, ${theme.bg}, ${theme.accent});`
          }"></div>
          <strong>${theme.name}</strong>
          <span class="hint">${theme.description || "Custom theme"}</span>
        </div>
      `
    )
    .join("");
}

function renderAdsTable() {
  const table = document.getElementById("adsTable");
  if (!table) return;
  if (!state.ads.length) {
    table.innerHTML = "<tr><td colspan=\"5\">No ads yet.</td></tr>";
    return;
  }
  table.innerHTML = state.ads
    .map((ad) => {
      const windowLabel = `${ad.starts_at ? formatDate(ad.starts_at) : "Any"} → ${
        ad.ends_at ? formatDate(ad.ends_at) : "Any"
      }`;
      return `
        <tr>
          <td>${clampText(ad.title || "", 40)}</td>
          <td>${ad.placement || "global"}</td>
          <td>${ad.status || "inactive"}</td>
          <td>${windowLabel}</td>
          <td>
            <div class="inline-actions">
              <button class="muted" data-action="toggle" data-id="${ad.id}">${
                ad.status === "active" ? "Pause" : "Activate"
              }</button>
              <button class="danger" data-action="delete" data-id="${ad.id}">Delete</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  table.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const ad = state.ads.find((item) => item.id === btn.dataset.id);
      if (!ad) return;
      if (btn.dataset.action === "toggle") {
        const nextStatus = ad.status === "active" ? "inactive" : "active";
        await updateAd(ad.id, { status: nextStatus });
      }
      if (btn.dataset.action === "delete") {
        if (!confirm("Delete this ad?")) return;
        await deleteAd(ad.id);
      }
      await refreshData();
      renderAdsTable();
    });
  });
}

function normalizeRequestStatus(status) {
  if (!status) return "open";
  const value = String(status).toLowerCase();
  if (["completed", "approved", "rejected", "pending"].includes(value)) return value;
  return value === "open" ? "open" : "open";
}

function requestStatusCell(status) {
  const value = normalizeRequestStatus(status);
  let className = "status-pill";
  if (value === "completed" || value === "approved") className = "status-pill completed";
  if (value === "rejected") className = "status-pill suspended";
  return `<span class="${className}">${escapeHTML(value)}</span>`;
}

function requestActionButton(status, kind, id) {
  const value = normalizeRequestStatus(status);
  const action = value === "completed" ? "reopen" : "complete";
  const label = value === "completed" ? "Reopen" : "Complete";
  return `<button class="muted" data-action="${action}" data-kind="${kind}" data-id="${id}">${label}</button>`;
}

function attachRequestHandlers(table, kind, updater) {
  if (!table) return;
  table.querySelectorAll(`button[data-kind='${kind}']`).forEach((btn) => {
    btn.addEventListener("click", async () => {
      const id = btn.dataset.id;
      const action = btn.dataset.action;
      if (!id || !action) return;
      const nextStatus = action === "complete" ? "completed" : "open";
      const result = await updater(id, nextStatus);
      if (result.error) {
        alert(result.error.message || "Update failed.");
        return;
      }
      await refreshData();
      renderRequests();
    });
  });
}

function renderRequests() {
  const contactTable = document.getElementById("contactTable");
  if (contactTable) {
    contactTable.innerHTML = state.contactRequests.length
      ? state.contactRequests
          .map(
            (item) => `
          <tr>
            <td>${escapeHTML(item.name || "")}</td>
            <td>${escapeHTML(item.email || "")}</td>
            <td>${clampText(escapeHTML(item.subject || ""), 40)}</td>
            <td>${clampText(escapeHTML(item.message || ""), 60)}</td>
            <td>${formatDate(item.created_at)}</td>
            <td>${requestStatusCell(item.status)}</td>
            <td>
              <div class="inline-actions">
                ${requestActionButton(item.status, "contact", item.id)}
              </div>
            </td>
          </tr>
        `
          )
          .join("")
      : "<tr><td colspan=\"7\">No contact requests yet.</td></tr>";
  }
  attachRequestHandlers(contactTable, "contact", updateContactRequestStatus);

  const supportTable = document.getElementById("supportTable");
  if (supportTable) {
    supportTable.innerHTML = state.supportRequests.length
      ? state.supportRequests
          .map(
            (item) => `
          <tr>
            <td>${escapeHTML(item.name || "")}</td>
            <td>${escapeHTML(item.email || "")}</td>
            <td>${clampText(escapeHTML(item.issue || ""), 40)}</td>
            <td>${clampText(escapeHTML(item.message || ""), 60)}</td>
            <td>${formatDate(item.created_at)}</td>
            <td>${requestStatusCell(item.status)}</td>
            <td>
              <div class="inline-actions">
                ${requestActionButton(item.status, "support", item.id)}
              </div>
            </td>
          </tr>
        `
          )
          .join("")
      : "<tr><td colspan=\"7\">No support requests yet.</td></tr>";
  }
  attachRequestHandlers(supportTable, "support", updateSupportRequestStatus);

  const newsletterTable = document.getElementById("newsletterTable");
  if (newsletterTable) {
    newsletterTable.innerHTML = state.newsletterSignups.length
      ? state.newsletterSignups
          .map(
            (item) => `
          <tr>
            <td>${escapeHTML(item.name || "")}</td>
            <td>${escapeHTML(item.email || "")}</td>
            <td>${escapeHTML(item.interest || "")}</td>
            <td>${formatDate(item.created_at)}</td>
            <td>${requestStatusCell(item.status)}</td>
            <td>
              <div class="inline-actions">
                ${requestActionButton(item.status, "newsletter", item.id)}
              </div>
            </td>
          </tr>
        `
          )
          .join("")
      : "<tr><td colspan=\"6\">No newsletter signups yet.</td></tr>";
  }
  attachRequestHandlers(newsletterTable, "newsletter", updateNewsletterSignupStatus);

  const adTable = document.getElementById("adsApplicationTable");
  if (adTable) {
    adTable.innerHTML = state.adApplications.length
      ? state.adApplications
          .map(
            (item) => `
          <tr>
            <td>${escapeHTML(item.name || "")}</td>
            <td>${escapeHTML(item.email || "")}</td>
            <td>${escapeHTML(item.company || "")}</td>
            <td>${escapeHTML(item.budget || "")}</td>
            <td>${clampText(escapeHTML(item.message || ""), 60)}</td>
            <td>${formatDate(item.created_at)}</td>
            <td>${requestStatusCell(item.status)}</td>
            <td>
              <div class="inline-actions">
                ${requestActionButton(item.status, "ads", item.id)}
              </div>
            </td>
          </tr>
        `
          )
          .join("")
      : "<tr><td colspan=\"8\">No ad applications yet.</td></tr>";
  }
  attachRequestHandlers(adTable, "ads", updateAdApplicationStatus);

  const adminTable = document.getElementById("adminRequestTable");
  if (adminTable) {
    adminTable.innerHTML = state.adminRequests.length
      ? state.adminRequests
          .map(
            (item) => `
          <tr>
            <td>${escapeHTML(item.user_name || "")}</td>
            <td>${escapeHTML(item.user_email || "")}</td>
            <td>${clampText(escapeHTML(item.message || ""), 60)}</td>
            <td>${formatDate(item.created_at)}</td>
            <td>${requestStatusCell(item.status)}</td>
          </tr>
        `
          )
          .join("")
      : "<tr><td colspan=\"5\">No admin requests yet.</td></tr>";
  }

  const contentTable = document.getElementById("contentRequestTable");
  if (contentTable) {
    contentTable.innerHTML = state.contentRequests.length
      ? state.contentRequests
          .map(
            (item) => `
          <tr>
            <td>${escapeHTML(item.query || "")}</td>
            <td>${escapeHTML(item.user_name || "Visitor")}</td>
            <td>${escapeHTML(item.user_email || "")}</td>
            <td>${formatDate(item.created_at)}</td>
            <td>${requestStatusCell(item.status)}</td>
            <td>
              <div class="inline-actions">
                ${requestActionButton(item.status, "content", item.id)}
              </div>
            </td>
          </tr>
        `
          )
          .join("")
      : "<tr><td colspan=\"6\">No content requests yet.</td></tr>";
  }
  attachRequestHandlers(contentTable, "content", updateContentRequestStatus);
}

function setupThemeForm() {
  const form = document.getElementById("themeForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.getElementById("themeName").value.trim();
    if (!name) return;
    let wallpaperUrl = "";
    if (themeWallpaperFile) {
      wallpaperUrl = await uploadMedia(themeWallpaperFile, "themes");
    }

    const payload = {
      id: crypto.randomUUID(),
      name,
      description: document.getElementById("themeDescription").value.trim(),
      bg: document.getElementById("themeBg").value,
      bg_deep: document.getElementById("themeBgDeep").value,
      ink: document.getElementById("themeInk").value,
      muted: document.getElementById("themeMuted").value,
      accent: document.getElementById("themeAccent").value,
      accent_strong: document.getElementById("themeAccentStrong").value,
      accent_cool: document.getElementById("themeAccentCool").value,
      card: document.getElementById("themeCard").value,
      card_solid: document.getElementById("themeCard").value,
      wallpaper_url: wallpaperUrl
    };

    const result = await createTheme(payload);
    const hint = document.getElementById("themeHint");
    if (hint) {
      hint.textContent = result.error ? "Theme creation failed." : "Theme added.";
    }
    if (!result.error && result.data) {
      state.themes.push(result.data);
      renderThemes();
      form.reset();
      themeWallpaperFile = null;
      themeWallpaperPreviewUrl = "";
      updateThemeWallpaperPreview("");
    }
  });
}

function setupAdForm() {
  const form = document.getElementById("adForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const title = document.getElementById("adTitle").value.trim();
    const body = document.getElementById("adBody").value.trim();
    const link = document.getElementById("adLink").value.trim();
    const imageUrl = document.getElementById("adImageUrl").value.trim();
    const placement = document.getElementById("adPlacement").value || "global";
    const status = document.getElementById("adStatus").value || "inactive";
    const startRaw = document.getElementById("adStart").value;
    const endRaw = document.getElementById("adEnd").value;
    if (!title || !link) return;

    let uploadedImage = "";
    if (adImageFile) {
      uploadedImage = await uploadMedia(adImageFile, "ads");
    }

    const payload = {
      id: crypto.randomUUID(),
      title,
      body,
      link_url: link,
      image_url: uploadedImage || imageUrl || "",
      placement,
      status,
      starts_at: startRaw ? new Date(startRaw).toISOString() : null,
      ends_at: endRaw ? new Date(endRaw).toISOString() : null,
      created_by: state.user?.id || null,
      created_at: new Date().toISOString()
    };

    const result = await createAd(payload);
    const hint = document.getElementById("adHint");
    if (hint) {
      hint.textContent = result.error ? "Ad creation failed." : "Ad saved.";
    }
    if (!result.error && result.data) {
      state.ads.unshift(result.data);
      renderAdsTable();
      form.reset();
      adImageFile = null;
      adImagePreviewUrl = "";
      updateAdImagePreview("");
    }
  });
}

function renderProfile() {
  const target = document.getElementById("adminProfile");
  if (!target) return;
  target.innerHTML = `
    <div class="badge">${getUserRole(state.user).toUpperCase()}</div>
    <h3>${getDisplayName(state.user)}</h3>
    <p>Email: ${state.user.email}</p>
  `;
}

function handleLogout() {
  const btn = document.getElementById("logoutBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    await logout();
    window.location.href = "login.html";
  });
}

async function refreshData() {
  const [
    categories,
    posts,
    comments,
    themes,
    ads,
    contactRequests,
    supportRequests,
    newsletterSignups,
    adApplications,
    adminRequests,
    contentRequests
  ] = await Promise.all([
    fetchCategories(),
    fetchPosts(),
    fetchComments(),
    fetchThemes(),
    fetchAds(),
    fetchContactRequests(),
    fetchSupportRequests(),
    fetchNewsletterSignups(),
    fetchAdApplications(),
    fetchAdminRequests(),
    fetchContentRequests()
  ]);
  state.categories = categories;
  state.posts = posts;
  state.comments = comments;
  state.themes = themes;
  state.ads = ads;
  state.contactRequests = contactRequests;
  state.supportRequests = supportRequests;
  state.newsletterSignups = newsletterSignups;
  state.adApplications = adApplications;
  state.adminRequests = adminRequests;
  state.contentRequests = contentRequests;
}

async function bootDashboard() {
  const user = await requireRole(["admin", "super"], "login.html");
  if (!user) return;
  state.user = user;
  setupTabs();
  setupImageInputs();
  setupScheduleToggle();
  bindRichEditorToolbar("postToolbar", "postEditor");
  updateCoverPreview("");
  updateThemeWallpaperPreview("");
  updateAdImagePreview("");
  await loadPostMedia(null);
  await refreshData();
  populateCategories();
  const customWrap = document.getElementById("customCategoryWrap");
  if (customWrap) customWrap.classList.add("hidden");
  const hint = document.getElementById("postFormHint");
  if (hint && !hint.textContent) {
    hint.textContent = "Tip: cover uploads work best with small files.";
  }
  handlePostForm();
  setupPostReview();
  renderPostsTable();
  renderCommentsTable();
  setupUsersPanel();
  setupThemeForm();
  renderThemes();
  setupAdForm();
  renderAdsTable();
  renderRequests();
  renderProfile();
  setupAnnouncementForm();
  await renderAnnouncementsTable();
  await setupCuratorBot();
  await setupFaq();
  handleLogout();
}

if (!handleLogin()) {
  bootDashboard();
}
