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
  if (filter === "all") renderAnnouncements(state.announcements);
  else renderAnnouncements(state.announcements.filter((a) => (a.type || "update") === filter));
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

function showAdminPanel() {
  const user = state.user;
  if (!user) return;

  const role = user.app_metadata?.role || user.user_metadata?.role;
  if (role === "admin" || role === "super") {
    const adminPanel = document.getElementById("adminPanel");
    if (adminPanel) adminPanel.style.display = "block";
    setupAnnouncementForm();
  }
}

function readPublishModeAndTime() {
  const modeEl = document.getElementById("publishMode");
  const timeEl = document.getElementById("publishTime");
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
  if (!form || form.dataset.bound === "1") return;
  form.dataset.bound = "1";

  form.addEventListener("submit", async (e) => {
    e.preventDefault();

    const title = (document.getElementById("announcementTitle")?.value || "").trim();
    const type = (document.getElementById("announcementType")?.value || "").trim();
    const body = (document.getElementById("announcementBody")?.value || "").trim();

    if (!title || !type || !body) {
      showStatus("All fields are required.", true);
      return;
    }

    const publish_at = readPublishModeAndTime();
    const isScheduled = new Date(publish_at).getTime() > Date.now();

    const announcement = {
      id: crypto.randomUUID(),
      title,
      type,
      body,
      message: body,
      status: isScheduled ? "scheduled" : "published",
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

    showStatus(
      isScheduled
        ? "Announcement scheduled. It will publish and notify users automatically."
        : "Announcement published. Users will be notified automatically.",
      false
    );

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
    setTimeout(() => { status.style.display = "none"; }, 3500);
  }
}

async function setupRealTimeAnnouncements() {
  try {
    supabase
      .channel("announcements_updates")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "announcements" }, async (payload) => {
        state.announcements.unshift(payload.new);
        if (state.activeFilter === "all") renderAnnouncements();
        else filterAnnouncements(state.activeFilter);
      })
      .subscribe();
  } catch (err) {
    console.warn("Real-time announcements setup failed:", err);
  }
}

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
  if (list) list.innerHTML = `<div class="callout">${escapeHTML(message)}</div>`;
});
