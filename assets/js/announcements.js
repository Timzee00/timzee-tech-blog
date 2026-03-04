import { supabase, getCurrentUserWithRole, getDisplayName, signOut } from "./supabase.js";
import { fetchSettings } from "./settings.js";
import { fetchThemeById, applyThemeVariables } from "./themes.js";
import { timeAgo, escapeHTML, extractErrorMessage, reportAppError } from "./utils.js";
import { setupReveal } from "./reveal.js";
import "./nav.js";

const state = {
  user: null,
  announcements: [],
  activeFilter: "all",
  settings: null
};

// ============================================================
// DB FETCHING
// ============================================================

async function fetchAnnouncements() {
  try {
    const { data, error } = await supabase
      .from("announcements")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("Fetch announcements error:", error);
      return [];
    }
    return data || [];
  } catch (err) {
    console.error("Announcements fetch failed:", err);
    return [];
  }
}

async function createAnnouncement(announcement) {
  try {
    // Remove undefined keys so Supabase doesn't reject unknown/undefined values
    Object.keys(announcement).forEach((k) => {
      if (announcement[k] === undefined) delete announcement[k];
    });

    const { data, error } = await supabase
      .from("announcements")
      .insert(announcement)
      .select()
      .single();

    if (error) return { error };
    return { data };
  } catch (err) {
    return { error: err };
  }
}

// ============================================================
// NOTIFICATIONS
// ============================================================

async function broadcastNotificationToAllUsers(title, body, type = "announcement") {
  try {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id");

    if (profilesError) throw profilesError;

    const userIds = (profiles || []).map((p) => p.id);

    const notifications = userIds.map((userId) => ({
      id: crypto.randomUUID(),
      user_id: userId,
      type: type,
      title: title,
      body: body,
      link_url: "/announcements.html",
      created_at: new Date().toISOString(),
      read_at: null
    }));

    if (notifications.length > 0) {
      const { error: notifError } = await supabase
        .from("notifications")
        .insert(notifications);

      if (notifError) throw notifError;
    }

    return { ok: true };
  } catch (err) {
    console.error("Broadcast error:", err);
    return { error: err.message || String(err) };
  }
}

// ============================================================
// UI RENDERING
// ============================================================

function renderAnnouncements(announcements = state.announcements) {
  const container = document.getElementById("announcementsList");
  const noMsg = document.getElementById("noAnnouncements");

  if (!container || !noMsg) return;

  if (!announcements.length) {
    container.innerHTML = "";
    noMsg.style.display = "block";
    return;
  }

  noMsg.style.display = "none";
  container.innerHTML = announcements
    .map((announcement) => {
      const type = (announcement.type || "update").toString().toLowerCase();
      const typeIcon =
        {
          update: "📝",
          feature: "✨",
          maintenance: "🔧",
          event: "🎉",
          alert: "⚠️"
        }[type] || "📢";

      const createdAt = announcement.created_at || announcement.publish_at || new Date().toISOString();
      const bodyText = announcement.body ?? announcement.message ?? "";

      return `
        <div class="announcement-card" data-type="${escapeHTML(type)}">
          <div class="announcement-header">
            <div>
              <span class="announcement-type-badge">${typeIcon} ${escapeHTML(
                type.charAt(0).toUpperCase() + type.slice(1)
              )}</span>
              <h3>${escapeHTML(announcement.title || "Announcement")}</h3>
            </div>
            <span class="announcement-date">${timeAgo(createdAt)}</span>
          </div>
          <div class="announcement-body">
            ${escapeHTML(bodyText)}
          </div>
        </div>
      `;
    })
    .join("");
}

function filterAnnouncements(filter) {
  state.activeFilter = filter;

  if (filter === "all") {
    renderAnnouncements(state.announcements);
  } else {
    const filtered = state.announcements.filter((a) => (a.type || "update") === filter);
    renderAnnouncements(filtered);
  }
}

function setupFilters() {
  document.querySelectorAll(".filter-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      filterAnnouncements(btn.dataset.filter);
    });
  });
}

// ============================================================
// ADMIN PANEL + FORM
// ============================================================

function showAdminPanel() {
  const user = state.user;
  if (!user) return;

  const role = user.user_metadata?.role;
  if (role === "admin" || role === "super") {
    const adminPanel = document.getElementById("adminPanel");
    if (adminPanel) adminPanel.style.display = "block";
    setupAnnouncementForm();
  }
}

function readPublishModeAndTime() {
  // Optional UI controls (if they exist)
  // - A dropdown that might say: "Publish now" or "Schedule"
  // - A datetime input for scheduling
  const modeEl = document.getElementById("publishMode"); // optional
  const timeEl = document.getElementById("publishTime"); // optional

  const mode = (modeEl?.value || "now").toLowerCase();
  const rawTime = timeEl?.value || "";

  if (mode.includes("schedule") && rawTime) {
    const dt = new Date(rawTime);
    if (!isNaN(dt.getTime())) return dt.toISOString();
  }

  return new Date().toISOString();
}

function setupAnnouncementForm() {
  const form = document.getElementById("announcementForm");
  const clearBtn = document.getElementById("clearAnnouncementBtn");

  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const title = (document.getElementById("announcementTitle")?.value || "").trim();
    const type = (document.getElementById("announcementType")?.value || "").trim();
    const body = (document.getElementById("announcementBody")?.value || "").trim();
    const notifyAll = !!document.getElementById("notifyAllUsers")?.checked;

    if (!title || !type || !body) {
      showStatus("All fields are required.", true);
      return;
    }

    const publish_at = readPublishModeAndTime();

    // ✅ Important: Send BOTH body and message so whichever your DB expects is satisfied
    // ✅ Also include status/publish_at for your UI
    const announcement = {
      id: crypto.randomUUID(),
      title,
      type,
      body,
      message: body,
      status: "success",
      publish_at,
      created_by: state.user?.id || null,
      created_at: new Date().toISOString()
    };

    const result = await createAnnouncement(announcement);

    if (result.error) {
      const msg = result.error?.message || String(result.error);
      showStatus("Failed to create announcement: " + msg, true);
      return;
    }

    if (notifyAll) {
      const broadcastResult = await broadcastNotificationToAllUsers(title, body, "announcement");
      if (broadcastResult.error) {
        showStatus("Announcement created but notification broadcast failed.", true);
      } else {
        showStatus("✓ Announcement published and all users notified!", false);
      }
    } else {
      showStatus("✓ Announcement published!", false);
    }

    form.reset();
    state.announcements = await fetchAnnouncements();
    renderAnnouncements();
  });

  clearBtn?.addEventListener("click", () => form.reset());
}

function showStatus(message, isError = false) {
  const status = document.getElementById("announcementStatus");
  if (!status) return;

  status.textContent = message;
  status.style.display = "block";
  status.style.color = isError ? "#ef4444" : "#059669";

  if (!isError) {
    setTimeout(() => {
      status.style.display = "none";
    }, 3000);
  }
}

// ============================================================
// REALTIME
// ============================================================

async function setupRealTimeAnnouncements() {
  try {
    supabase
      .channel("announcements_updates")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "announcements" },
        async (payload) => {
          state.announcements.unshift(payload.new);
          // respect current filter
          if (state.activeFilter === "all") renderAnnouncements();
          else filterAnnouncements(state.activeFilter);
        }
      )
      .subscribe();
  } catch (err) {
    console.warn("Real-time announcements setup failed:", err);
  }
}

// ============================================================
// BOOT
// ============================================================

async function boot() {
  setupReveal();

  const settings = await fetchSettings();
  if (settings?.themeId) {
    const theme = await fetchThemeById(settings.themeId);
    if (theme) applyThemeVariables(theme);
  }
  state.settings = settings;

  state.user = await getCurrentUserWithRole();

  state.announcements = await fetchAnnouncements();
  renderAnnouncements();
  setupFilters();
  showAdminPanel();
  setupRealTimeAnnouncements();
}

boot().catch((error) => {
  reportAppError(error, "Announcements load failed");
  const message = extractErrorMessage(error, "Unable to load announcements.");
  const list = document.getElementById("announcementsList");
  if (list) {
    list.innerHTML = `<div class="callout">${escapeHTML(message)}</div>`;
  }
});
