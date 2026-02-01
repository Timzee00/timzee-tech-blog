import { login, requireRole, logout, getSession } from "./auth.js";
import {
  fetchCategories,
  fetchPosts,
  fetchComments,
  fetchPostLikes,
  fetchThemes,
  createTheme,
  updatePost,
  deletePost,
  fetchAdminRequests,
  updateAdminRequestStatus
} from "./data.js";
import { fetchSettings, upsertSettings, DEFAULT_SETTINGS } from "./settings.js";
import { toTagArray, slugify, clampText, normalizeTags, escapeHTML, isSafeUrl } from "./utils.js";
import { startPresence, onPresenceUpdate } from "./presence.js";
import { bindRichEditorToolbar } from "./editor-tools.js";

let currentSettings = DEFAULT_SETTINGS;
let currentPosts = [];
let currentCategories = [];
let currentComments = [];
let currentLikes = [];
let editingPostId = null;
let liveVisitors = 0;
let currentUsers = [];
let currentUser = null;
let adminRequests = [];
let userSearch = "";
let userPage = 1;
let userHasMore = false;
const userPerPage = 200;

function toLocalDateTimeValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const offset = date.getTimezoneOffset() * 60000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function handleLogin() {
  const form = document.getElementById("superLoginForm");
  if (!form) return false;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();
    const message = document.getElementById("loginMessage");
    const result = await login(email, password, ["super"]);
    if (!result.ok) {
      message.textContent = result.message;
      return;
    }
    window.location.href = "professional-panel.html";
  });
  return true;
}

function setupTabs() {
  const buttons = document.querySelectorAll(".admin-nav button");
  const panels = document.querySelectorAll("[data-panel]");
  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      buttons.forEach((btn) => btn.classList.remove("active"));
      button.classList.add("active");
      panels.forEach((panel) => {
        panel.style.display = panel.dataset.panel === button.dataset.tab ? "block" : "none";
      });
    });
  });
}

function setupSuperScheduleToggle() {
  const statusSelect = document.getElementById("superPostStatus");
  const publishInput = document.getElementById("superPostPublishAt");
  if (!statusSelect || !publishInput) return;
  const toggle = () => {
    publishInput.style.display = statusSelect.value === "scheduled" ? "block" : "none";
  };
  statusSelect.addEventListener("change", toggle);
  toggle();
}

function setMessage(target, message, isError = false) {
  if (!target) return;
  target.textContent = message;
  target.style.color = isError ? "#fca5a5" : "#cbd5f5";
}

async function setupAdminCreate() {
  const form = document.getElementById("adminCreateForm");
  const message = document.getElementById("adminCreateMessage");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = document.getElementById("newAdminName").value.trim();
    const username = document.getElementById("newAdminUsername")?.value.trim();
    const email = document.getElementById("newAdminUser").value.trim();
    const password = document.getElementById("newAdminPass").value.trim();
    if (!name || !email) {
      setMessage(message, "Display name and email are required.", true);
      return;
    }
    const session = await getSession();
    const token = session?.access_token;
    if (!token) {
      setMessage(message, "Auth token missing. Log in again.", true);
      return;
    }
    const response = await fetch("/.netlify/functions/create-admin", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`
      },
      body: JSON.stringify({ displayName: name, username, email, password })
    });
    const result = await response.json();
    if (!response.ok) {
      setMessage(message, result.error || "Admin creation failed.", true);
      return;
    }
    const mode = result.mode === "promoted" ? "promoted" : "created";
    setMessage(message, `Admin ${mode} successfully.`);
    form.reset();
    const admins = await fetchAdmins();
    if (admins.data) renderAdminsTable(admins.data);
  });
}

function renderAdminTableNote() {
  const table = document.getElementById("adminTable");
  if (!table) return;
  table.innerHTML = `
    <tr>
      <td colspan="7">
        <div class="callout">
          Loading admin accounts...
        </div>
      </td>
    </tr>
  `;
}

async function fetchAdmins() {
  const session = await getSession();
  const token = session?.access_token;
  if (!token) {
    return { error: "Auth token missing." };
  }
  const response = await fetch("/.netlify/functions/list-admins", {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });
  const result = await response.json();
  if (!response.ok) {
    return { error: result.error || "Failed to load admins." };
  }
  return { data: result.admins || [] };
}

function renderAdminsTable(admins) {
  const table = document.getElementById("adminTable");
  const detail = document.getElementById("adminPostsDetail");
  if (!table) return;
  if (!admins.length) {
    table.innerHTML = `
      <tr>
        <td colspan="7">
          <div class="callout">No admins found.</div>
        </td>
      </tr>
    `;
    return;
  }
  table.innerHTML = admins
    .map(
      (admin) => `
        <tr>
          <td>${admin.display_name || "Admin"}</td>
          <td>${admin.email}</td>
          <td>${admin.role}</td>
          <td>${admin.post_count || 0}</td>
          <td>${admin.last_post_at ? new Date(admin.last_post_at).toLocaleDateString() : "—"}</td>
          <td>${admin.created_at ? new Date(admin.created_at).toLocaleDateString() : "—"}</td>
          <td>
            <div class="inline-actions">
              <button class="muted" data-action="view" data-id="${admin.id}">View Posts</button>
              <button class="muted" data-action="reset" data-id="${admin.id}">Reset Password</button>
              <button class="danger" data-action="remove" data-id="${admin.id}">Remove</button>
            </div>
          </td>
        </tr>
      `
    )
    .join("");

  table.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;
      const userId = btn.dataset.id;
      if (!userId) return;
      const session = await getSession();
      const token = session?.access_token;
      if (!token) return;
      if (action === "view") {
        const admin = admins.find((item) => item.id === userId);
        if (!admin || !detail) return;
        const list = (admin.recent_posts || [])
          .map(
            (post) =>
              `<li><a href="../post.html?id=${post.id}" target="_blank" rel="noopener">${post.title}</a></li>`
          )
          .join("");
        detail.innerHTML = `
          <strong>${admin.display_name}</strong> recent posts:
          ${list ? `<ul>${list}</ul>` : "<div>No posts yet.</div>"}
        `;
        detail.style.display = "block";
        detail.scrollIntoView({ behavior: "smooth", block: "center" });
      }
      if (action === "reset") {
        const newPass = prompt("Enter a new password for this admin");
        if (!newPass) return;
        const response = await fetch("/.netlify/functions/update-admin", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ action: "reset_password", userId, password: newPass })
        });
        const result = await response.json();
        if (!response.ok) {
          alert(result.error || "Password reset failed.");
          return;
        }
        alert("Password reset.");
      }
      if (action === "remove") {
        if (!confirm("Remove this admin?")) return;
        const response = await fetch("/.netlify/functions/update-admin", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({ action: "delete", userId })
        });
        const result = await response.json();
        if (!response.ok) {
          alert(result.error || "Admin removal failed.");
          return;
        }
        const admins = await fetchAdmins();
        if (admins.data) renderAdminsTable(admins.data);
      }
    });
  });
}

function renderAdminRequests() {
  const table = document.getElementById("adminRequestTableSuper");
  if (!table) return;
  if (!adminRequests.length) {
    table.innerHTML = `
      <tr>
        <td colspan="6">
          <div class="callout">No admin requests yet.</div>
        </td>
      </tr>
    `;
    return;
  }

  table.innerHTML = adminRequests
    .map((request) => {
      const status = request.status || "pending";
      const actions =
        status === "pending"
          ? `
            <div class="inline-actions">
              <button class="muted" data-action="approve" data-id="${request.id}">Approve</button>
              <button class="danger" data-action="reject" data-id="${request.id}">Reject</button>
            </div>
          `
          : "<span class=\"hint\">Reviewed</span>";
      return `
        <tr>
          <td>${escapeHTML(request.user_name || "Member")}</td>
          <td>${escapeHTML(request.user_email || "")}</td>
          <td>${clampText(escapeHTML(request.message || ""), 60)}</td>
          <td>${request.created_at ? new Date(request.created_at).toLocaleDateString() : "—"}</td>
          <td>${escapeHTML(status)}</td>
          <td>${actions}</td>
        </tr>
      `;
    })
    .join("");

  table.querySelectorAll("button[data-action]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = btn.dataset.action;
      const id = btn.dataset.id;
      const request = adminRequests.find((item) => item.id === id);
      if (!request) return;
      if (action === "reject") {
        await updateAdminRequestStatus(id, "rejected", currentUser?.id || null);
        await loadAdminRequests();
        return;
      }
      if (action === "approve") {
        const session = await getSession();
        const token = session?.access_token;
        if (!token) {
          alert("Auth token missing. Log in again.");
          return;
        }
        const response = await fetch("/.netlify/functions/create-admin", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            email: request.user_email,
            displayName: request.user_name || "",
            username: request.user_name ? request.user_name.toLowerCase().replace(/\s+/g, "") : ""
          })
        });
        const result = await response.json();
        if (!response.ok) {
          alert(result.error || "Admin promotion failed.");
          return;
        }
        await updateAdminRequestStatus(id, "approved", currentUser?.id || null);
        await loadAdminRequests();
        const admins = await fetchAdmins();
        if (admins.data) renderAdminsTable(admins.data);
      }
    });
  });
}

async function loadAdminRequests() {
  adminRequests = await fetchAdminRequests();
  renderAdminRequests();
}

async function fetchUsers({ search = "", page = 1, perPage = userPerPage } = {}) {
  const session = await getSession();
  const token = session?.access_token;
  if (!token) {
    return { error: "Auth token missing." };
  }
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
  const table = document.getElementById("superUsersTable");
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
              <button class="muted" data-action="${user.is_featured ? "unfeature" : "feature"}" data-id="${
                user.id
              }">${user.is_featured ? "Unfeature" : "Feature"}</button>
              <button class="muted" data-action="${user.is_staff_pick ? "unstaff" : "staff"}" data-id="${
                user.id
              }">${user.is_staff_pick ? "Unstaff" : "Staff Pick"}</button>
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
      await loadUsers(userSearch);
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
      await loadUsers(userSearch);
    });
  });
}

function updateUserPager() {
  const prevBtn = document.getElementById("superUserPrevBtn");
  const nextBtn = document.getElementById("superUserNextBtn");
  const info = document.getElementById("superUserPageInfo");
  if (!prevBtn || !nextBtn || !info) return;
  if (userSearch) {
    info.textContent = "Search results";
    prevBtn.disabled = true;
    nextBtn.disabled = true;
    return;
  }
  info.textContent = `Page ${userPage}`;
  prevBtn.disabled = userPage <= 1;
  nextBtn.disabled = !userHasMore;
}

async function loadUsers(search = "", page = 1) {
  const hint = document.getElementById("superUsersHint");
  if (hint) hint.textContent = "Loading users...";
  const nextPage = search ? 1 : page;
  const result = await fetchUsers({ search, page: nextPage });
  if (result.error) {
    if (hint) hint.textContent = result.error;
    renderUsersTable([]);
    return;
  }
  currentUsers = result.data;
  userPage = result.page || nextPage;
  userHasMore = !!result.hasMore;
  if (hint) {
    hint.textContent = `Showing ${currentUsers.length} user${currentUsers.length === 1 ? "" : "s"}.`;
  }
  renderUsersTable(currentUsers);
  updateUserPager();
}

function setupUsersPanel() {
  const input = document.getElementById("superUserSearchInput");
  const searchBtn = document.getElementById("superUserSearchBtn");
  const clearBtn = document.getElementById("superUserClearBtn");
  const prevBtn = document.getElementById("superUserPrevBtn");
  const nextBtn = document.getElementById("superUserNextBtn");
  if (searchBtn) {
    searchBtn.addEventListener("click", () => {
      userSearch = input?.value.trim() || "";
      userPage = 1;
      loadUsers(userSearch, 1);
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      if (input) input.value = "";
      userSearch = "";
      userPage = 1;
      loadUsers("", 1);
    });
  }
  if (input) {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        userSearch = input.value.trim();
        userPage = 1;
        loadUsers(userSearch, 1);
      }
    });
  }
  if (prevBtn) {
    prevBtn.addEventListener("click", () => {
      if (userSearch) return;
      const next = Math.max(1, userPage - 1);
      loadUsers("", next);
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener("click", () => {
      if (userSearch || !userHasMore) return;
      loadUsers("", userPage + 1);
    });
  }
  loadUsers("", 1);
}

function renderAnalysis() {
  const stats = document.getElementById("analysisStats");
  const topPosts = document.getElementById("analysisTopPosts");
  if (!stats || !topPosts) return;

  const totalPosts = currentPosts.length;
  const published = currentPosts.filter((post) => post.status === "published").length;
  const comments = currentComments.length;
  const pendingComments = currentComments.filter((comment) => comment.status === "pending").length;
  const totalLikes = currentLikes.length;
  const totalViews = currentPosts.reduce((sum, post) => sum + (post.views || 0), 0);

  stats.innerHTML = [
    { label: "Live Visitors", value: liveVisitors },
    { label: "Total Posts", value: totalPosts },
    { label: "Published", value: published },
    { label: "Comments", value: comments },
    { label: "Pending Comments", value: pendingComments },
    { label: "Likes", value: totalLikes },
    { label: "Views", value: totalViews }
  ]
    .map(
      (stat) =>
        `<div class="stat-tile"><span>${stat.label}</span><strong>${stat.value}</strong></div>`
    )
    .join("");

  const likeCounts = currentLikes.reduce((acc, like) => {
    acc[like.post_id] = (acc[like.post_id] || 0) + 1;
    return acc;
  }, {});

  const top = [...currentPosts]
    .sort(
      (a, b) =>
        (likeCounts[b.id] || 0) * 2 + (b.views || 0) -
        ((likeCounts[a.id] || 0) * 2 + (a.views || 0))
    )
    .slice(0, 5);

  topPosts.innerHTML = top.length
    ? `
        <strong>Top Posts</strong>
        <ul>
          ${top
            .map(
              (post) =>
                `<li><a href="../post.html?id=${post.id}" target="_blank" rel="noopener">${clampText(
                  post.title || "",
                  70
                )}</a></li>`
            )
            .join("")}
        </ul>
      `
    : "No posts yet.";
}

function populateSuperCategories() {
  const select = document.getElementById("superPostCategory");
  if (!select) return;
  select.innerHTML = currentCategories
    .map((cat) => `<option value="${cat.id}">${cat.name}</option>`)
    .join("");
}

function resetSuperPostForm() {
  editingPostId = null;
  const form = document.getElementById("superPostForm");
  if (form) form.reset();
  const editor = document.getElementById("superPostEditor");
  if (editor) editor.innerHTML = "";
  const hint = document.getElementById("superPostHint");
  if (hint) hint.textContent = "";
  const statusSelect = document.getElementById("superPostStatus");
  if (statusSelect) statusSelect.dispatchEvent(new Event("change"));
  const reviewPane = document.getElementById("superPostReview");
  if (reviewPane) reviewPane.classList.add("hidden");
}

function renderSuperPostsTable() {
  const table = document.getElementById("superPostsTable");
  if (!table) return;
  table.innerHTML = currentPosts
    .map((post) => {
      const category = currentCategories.find((cat) => cat.id === post.category_id);
      return `
        <tr>
          <td>${clampText(post.title || "", 40)}</td>
          <td>${category ? category.name : ""}</td>
          <td>${post.status || "published"}</td>
          <td>${new Date(post.updated_at || post.created_at).toLocaleDateString()}</td>
          <td>
            <div class="inline-actions">
              <button class="muted" data-action="edit" data-id="${post.id}">Edit</button>
              <button class="muted" data-action="pin" data-id="${post.id}">${
                post.pinned ? "Unpopular" : "Popular"
              }</button>
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
      const post = currentPosts.find((item) => item.id === btn.dataset.id);
      if (!post) return;
      if (action === "edit") {
        editingPostId = post.id;
        document.getElementById("superPostTitle").value = post.title || "";
        document.getElementById("superPostCategory").value = post.category_id;
        document.getElementById("superPostTags").value = normalizeTags(post.tags).join(", ");
        document.getElementById("superPostCover").value = post.cover || "";
        document.getElementById("superPostStatus").value = post.status || "published";
        document.getElementById("superPostPublishAt").value = toLocalDateTimeValue(post.publish_at);
        document.getElementById("superPostStatus").dispatchEvent(new Event("change"));
        document.getElementById("superPostPinned").checked = !!post.pinned;
        const editor = document.getElementById("superPostEditor");
        if (editor) editor.innerHTML = window.normalizeHtml ? window.normalizeHtml(post.content || "") : (post.content || "");
        const hint = document.getElementById("superPostHint");
        if (hint) hint.textContent = "Editing post.";
      }
      if (action === "pin") {
        await updatePost(post.id, { pinned: !post.pinned });
        await loadAnalysisData();
        renderSuperPostsTable();
      }
      if (action === "delete") {
        if (!confirm("Delete this post?")) return;
        await deletePost(post.id);
        await loadAnalysisData();
        renderSuperPostsTable();
        renderAnalysis();
      }
    });
  });
}

function setupSuperPostForm() {
  const form = document.getElementById("superPostForm");
  if (!form) return;
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!editingPostId) return;
    const title = document.getElementById("superPostTitle").value.trim();
    const categoryId = document.getElementById("superPostCategory").value;
    const tags = toTagArray(document.getElementById("superPostTags").value);
    const cover = document.getElementById("superPostCover").value.trim();
    const status = document.getElementById("superPostStatus").value;
    const publishAtRaw = document.getElementById("superPostPublishAt").value;
    const publishAt = publishAtRaw ? new Date(publishAtRaw).toISOString() : null;
    const pinned = document.getElementById("superPostPinned").checked;
    const editor = document.getElementById("superPostEditor");
    const contentRaw = editor?.innerHTML?.trim() || "";
    const contentText = editor?.innerText?.trim() || "";
    const content = window.normalizeHtml ? window.normalizeHtml(contentRaw) : contentRaw;
    if (!title || !contentText) return;
    if (status === "scheduled" && !publishAt) {
      const hint = document.getElementById("superPostHint");
      if (hint) hint.textContent = "Add a publish date for scheduled posts.";
      return;
    }

    const updates = {
      title,
      slug: slugify(title),
      category_id: categoryId,
      tags,
      cover,
      status,
      publish_at: status === "scheduled" ? publishAt : null,
      pinned,
      content,
      updated_at: new Date().toISOString()
    };
    const result = await updatePost(editingPostId, updates);
    const hint = document.getElementById("superPostHint");
    if (hint) {
      hint.textContent = result.error ? "Update failed." : "Post updated.";
    }
    await loadAnalysisData();
    renderSuperPostsTable();
    renderAnalysis();
  });

  const reset = document.getElementById("superPostReset");
  if (reset) {
    reset.addEventListener("click", resetSuperPostForm);
  }
}

function setupSuperPostReview() {
  const reviewBtn = document.getElementById("superPostReviewBtn");
  const reviewPane = document.getElementById("superPostReview");
  const closeBtn = document.getElementById("superCloseReviewBtn");
  if (!reviewBtn || !reviewPane) return;

  const renderReview = () => {
    const title = document.getElementById("superPostTitle").value.trim();
    const categorySelect = document.getElementById("superPostCategory");
    const categoryLabel = categorySelect?.selectedOptions?.[0]?.textContent || "Category";
    const tags = document.getElementById("superPostTags").value.trim();
    const coverUrl = document.getElementById("superPostCover").value.trim();
    const editor = document.getElementById("superPostEditor");
    const raw = editor?.innerHTML?.trim() || "";
    const content = window.normalizeHtml ? window.normalizeHtml(raw) : raw;

    document.getElementById("superReviewTitle").textContent = title || "Untitled post";
    document.getElementById("superReviewCategory").textContent = categoryLabel;
    document.getElementById("superReviewTags").textContent = tags ? `Tags: ${tags}` : "";
    const cover = document.getElementById("superReviewCover");
    if (cover) {
      cover.innerHTML = coverUrl && isSafeUrl(coverUrl) ? `<img src="${escapeHTML(coverUrl)}" alt="Cover preview">` : "";
    }
    const reviewContent = document.getElementById("superReviewContent");
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

async function setupSettingsForm() {
  const form = document.getElementById("settingsForm");
  if (!form) return;
  currentSettings = await fetchSettings();
  const themes = await fetchThemes();
  const themeSelect = document.getElementById("siteThemeSelect");
  const seedBtn = document.getElementById("seedThemesBtn");
  if (themeSelect) {
    themeSelect.innerHTML = `
      <option value="">Default</option>
      ${themes
        .map((theme) => `<option value="${theme.id}">${theme.name}</option>`)
        .join("")}
    `;
    themeSelect.value = currentSettings.themeId || "";
  }
  if (seedBtn && !seedBtn.dataset.ready) {
    seedBtn.addEventListener("click", async () => {
      const existing = await fetchThemes();
      const names = new Set(existing.map((item) => item.name));
      const starter = [
        {
          name: "Warm Sand",
          description: "Warm neutrals with bright orange accents.",
          bg: "#f6f1ea",
          bg_deep: "#efe4d6",
          ink: "#131417",
          muted: "#5b6573",
          accent: "#0f766e",
          accent_strong: "#f97316",
          accent_cool: "#0ea5e9",
          card: "#ffffff",
          card_solid: "#ffffff"
        },
        {
          name: "Midnight Circuit",
          description: "Dark tech dashboard with neon teal accents.",
          bg: "#0f172a",
          bg_deep: "#111827",
          ink: "#f8fafc",
          muted: "#94a3b8",
          accent: "#14b8a6",
          accent_strong: "#38bdf8",
          accent_cool: "#22d3ee",
          card: "#111827",
          card_solid: "#0f172a"
        },
        {
          name: "Ocean Fog",
          description: "Cool fog with airy blues for long reading.",
          bg: "#eef4f6",
          bg_deep: "#dbe7ee",
          ink: "#0f172a",
          muted: "#64748b",
          accent: "#0284c7",
          accent_strong: "#f97316",
          accent_cool: "#38bdf8",
          card: "#ffffff",
          card_solid: "#ffffff"
        }
      ];

      for (const theme of starter) {
        if (names.has(theme.name)) continue;
        await createTheme({ id: crypto.randomUUID(), ...theme });
      }

      const updated = await fetchThemes();
      if (themeSelect) {
        themeSelect.innerHTML = `
          <option value="">Default</option>
          ${updated
            .map((theme) => `<option value="${theme.id}">${theme.name}</option>`)
            .join("")}
        `;
        themeSelect.value = currentSettings.themeId || "";
      }
      alert("Starter themes added.");
    });
    seedBtn.dataset.ready = "true";
  }
  document.getElementById("siteNameInput").value = currentSettings.siteName;
  document.getElementById("siteTaglineInput").value = currentSettings.tagline;
  document.getElementById("accentColorInput").value = currentSettings.themeAccent || "#0f766e";
  document.getElementById("rulesInput").value = currentSettings.rules || "";
  document.getElementById("moderationToggle").checked =
    currentSettings.features.commentModeration;
  document.getElementById("imageToggle").checked = currentSettings.features.allowImageComments;
  document.getElementById("whatsappNumberInput").value =
    currentSettings.support.whatsappNumber || "";
  document.getElementById("whatsappMessageInput").value =
    currentSettings.support.whatsappMessage || "";
  document.getElementById("donationToggle").checked = currentSettings.donation.enabled;
  document.getElementById("donationTitleInput").value =
    currentSettings.donation.title || "";
  document.getElementById("donationDetailsInput").value =
    currentSettings.donation.details || "";
  document.getElementById("donationUrlInput").value =
    currentSettings.donation.url || "";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    currentSettings.siteName = document.getElementById("siteNameInput").value.trim();
    currentSettings.tagline = document.getElementById("siteTaglineInput").value.trim();
    currentSettings.themeAccent = document.getElementById("accentColorInput").value;
    currentSettings.rules = document.getElementById("rulesInput").value.trim();
    currentSettings.features.commentModeration =
      document.getElementById("moderationToggle").checked;
    currentSettings.features.allowImageComments =
      document.getElementById("imageToggle").checked;
    currentSettings.support.whatsappNumber =
      document.getElementById("whatsappNumberInput").value.trim();
    currentSettings.support.whatsappMessage =
      document.getElementById("whatsappMessageInput").value.trim();
    currentSettings.donation.enabled = document.getElementById("donationToggle").checked;
    currentSettings.donation.title =
      document.getElementById("donationTitleInput").value.trim();
    currentSettings.donation.details =
      document.getElementById("donationDetailsInput").value.trim();
    currentSettings.donation.url =
      document.getElementById("donationUrlInput").value.trim();
    if (themeSelect) {
      currentSettings.themeId = themeSelect.value || "";
    }
    const result = await upsertSettings(currentSettings);
    if (result.error) {
      alert(result.error.message || "Settings update failed. Check site_settings policies.");
      return;
    }
    document.documentElement.style.setProperty("--accent", currentSettings.themeAccent);
    alert("Settings saved.");
  });
}

async function setupAdsForm() {
  const form = document.getElementById("adsForm");
  if (!form) return;
  currentSettings = await fetchSettings();
  document.getElementById("publisherIdInput").value =
    currentSettings.adSense.publisherId || "";
  document.getElementById("homeTopSlotInput").value = currentSettings.adSense.slots.homeTop || "";
  document.getElementById("sidebarSlotInput").value =
    currentSettings.adSense.slots.homeSidebar || "";
  document.getElementById("postInlineSlotInput").value =
    currentSettings.adSense.slots.postInline || "";
  document.getElementById("adsToggle").checked = currentSettings.adSense.enabled;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    currentSettings.adSense.publisherId =
      document.getElementById("publisherIdInput").value.trim();
    currentSettings.adSense.slots.homeTop =
      document.getElementById("homeTopSlotInput").value.trim();
    currentSettings.adSense.slots.homeSidebar =
      document.getElementById("sidebarSlotInput").value.trim();
    currentSettings.adSense.slots.postInline =
      document.getElementById("postInlineSlotInput").value.trim();
    currentSettings.adSense.enabled = document.getElementById("adsToggle").checked;
    const result = await upsertSettings(currentSettings);
    if (result.error) {
      alert(result.error.message || "Ad settings update failed. Check site_settings policies.");
      return;
    }
    alert("Ad settings updated.");
  });
}

function setupDangerZone() {
  const btn = document.getElementById("resetDataBtn");
  if (!btn) return;
  btn.addEventListener("click", () => {
    alert("Reset is disabled in production. Use your database dashboard to clear data.");
  });
}

async function setupScoutBot() {
  const btn = document.getElementById("runScoutBtn");
  const status = document.getElementById("scoutStatus");
  if (!btn) return;
  const setStatus = (message, isError = false) => {
    if (!status) return;
    status.textContent = message;
    status.style.color = isError ? "#fca5a5" : "#cbd5f5";
  };
  btn.addEventListener("click", async () => {
    const session = await getSession();
    const token = session?.access_token;
    if (!token) {
      setStatus("Auth token missing. Log in again.", true);
      return;
    }
    setStatus("Running scout bot...");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    let response = null;
    try {
      response = await fetch("/.netlify/functions/scout-news", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`
        },
        signal: controller.signal
      });
    } catch (error) {
      clearTimeout(timeout);
      setStatus("Scout bot request failed. Check your Netlify function logs.", true);
      return;
    }
    clearTimeout(timeout);
    let result = null;
    try {
      result = await response.json();
    } catch (error) {
      setStatus("Scout bot returned an unexpected response.", true);
      return;
    }
    if (!response.ok) {
      setStatus(result.error || "Scout bot failed.", true);
      return;
    }
    const count = result.posted ? result.posted.length : 0;
    const errorCount = result.feedErrors ? result.feedErrors.length : 0;
    const detail = errorCount ? ` (${errorCount} feeds failed)` : "";
    setStatus(`Scout completed. Submitted ${count} items for review${detail}.`);
  });
}

function setupLiveVisitors() {
  startPresence("super-panel");
  onPresenceUpdate((count) => {
    liveVisitors = count;
    renderAnalysis();
  });
}

async function loadAnalysisData() {
  const [categories, posts, comments, likes] = await Promise.all([
    fetchCategories(),
    fetchPosts(),
    fetchComments(),
    fetchPostLikes()
  ]);
  currentCategories = categories;
  currentPosts = posts;
  currentComments = comments;
  currentLikes = likes;
}

function handleLogout() {
  const btn = document.getElementById("logoutBtn");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    await logout();
    window.location.href = "login.html";
  });
}

async function bootPanel() {
  const session = await requireRole(["super"], "login.html");
  if (!session) return;
  currentUser = session;
  setupTabs();
  await setupAdminCreate();
  renderAdminTableNote();
  const adminsResult = await fetchAdmins();
  if (adminsResult.error) {
    const table = document.getElementById("adminTable");
    if (table) {
      table.innerHTML = `
        <tr>
          <td colspan="7">
            <div class="callout">${adminsResult.error}</div>
          </td>
        </tr>
      `;
    }
  } else {
    renderAdminsTable(adminsResult.data);
  }
  await loadAdminRequests();
  setupUsersPanel();
  await loadAnalysisData();
  renderAnalysis();
  populateSuperCategories();
  bindRichEditorToolbar("superPostToolbar", "superPostEditor");
  setupSuperPostReview();
  setupSuperScheduleToggle();
  setupSuperPostForm();
  renderSuperPostsTable();
  await setupSettingsForm();
  await setupAdsForm();
  setupLiveVisitors();
  await setupScoutBot();
  setupDangerZone();
  handleLogout();
}

if (!handleLogin()) {
  bootPanel();
}
