import { supabase, getCurrentUserWithRole, getDisplayName, signOut } from "./supabase.js";
import { fetchSettings } from "./settings.js";
import { fetchThemeById, applyThemeVariables } from "./themes.js";
import { timeAgo, escapeHTML } from "./utils.js";
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
    const { data, error } = await supabase
      .from("announcements")
      .insert(announcement)
      .select()
      .single();
    
    if (error) return { error };
    return { data };
  } catch (err) {
    return { error: err.message };
  }
}

async function broadcastNotificationToAllUsers(title, body, type = "announcement") {
  try {
    // Get all user IDs from profiles table
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id");
    
    if (profilesError) throw profilesError;
    
    const userIds = profiles.map(p => p.id);
    
    // Create notifications for each user
    const notifications = userIds.map(userId => ({
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
    return { error: err.message };
  }
}

function renderAnnouncements(announcements = state.announcements) {
  const container = document.getElementById("announcementsList");
  const noMsg = document.getElementById("noAnnouncements");
  
  if (!announcements.length) {
    container.innerHTML = "";
    noMsg.style.display = "block";
    return;
  }
  
  noMsg.style.display = "none";
  container.innerHTML = announcements
    .map(announcement => {
      const typeIcon = {
        update: "📝",
        feature: "✨",
        maintenance: "🔧",
        event: "🎉",
        alert: "⚠️"
      }[announcement.type] || "📢";
      
      return `
        <div class="announcement-card" data-type="${announcement.type}">
          <div class="announcement-header">
            <div>
              <span class="announcement-type-badge">${typeIcon} ${announcement.type.charAt(0).toUpperCase() + announcement.type.slice(1)}</span>
              <h3>${escapeHTML(announcement.title)}</h3>
            </div>
            <span class="announcement-date">${timeAgo(announcement.created_at)}</span>
          </div>
          <div class="announcement-body">
            ${escapeHTML(announcement.body)}
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
    const filtered = state.announcements.filter(a => a.type === filter);
    renderAnnouncements(filtered);
  }
}

function setupFilters() {
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      filterAnnouncements(btn.dataset.filter);
    });
  });
}

function showAdminPanel() {
  const user = state.user;
  if (!user) return;
  
  // Check if user is admin or super
  const role = user.user_metadata?.role;
  if (role === "admin" || role === "super") {
    document.getElementById("adminPanel").style.display = "block";
    setupAnnouncementForm();
  }
}

function setupAnnouncementForm() {
  const form = document.getElementById("announcementForm");
  const clearBtn = document.getElementById("clearAnnouncementBtn");
  
  if (!form) return;
  
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    
    const title = document.getElementById("announcementTitle").value.trim();
    const type = document.getElementById("announcementType").value;
    const body = document.getElementById("announcementBody").value.trim();
    const notifyAll = document.getElementById("notifyAllUsers").checked;
    
    if (!title || !type || !body) {
      showStatus("All fields are required.", true);
      return;
    }
    
    const announcement = {
      id: crypto.randomUUID(),
      title,
      type,
      body,
      created_by: state.user.id,
      created_at: new Date().toISOString()
    };
    
    const result = await createAnnouncement(announcement);
    
    if (result.error) {
      showStatus("Failed to create announcement: " + result.error.message, true);
      return;
    }
    
    // Broadcast notification if checkbox is checked
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
    
    // Reset form and refresh list
    form.reset();
    state.announcements = await fetchAnnouncements();
    renderAnnouncements();
  });
  
  clearBtn.addEventListener("click", () => {
    form.reset();
  });
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

async function setupRealTimeAnnouncements() {
  try {
    const channel = supabase
      .channel("announcements_updates")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "announcements"
        },
        async (payload) => {
          state.announcements.unshift(payload.new);
          renderAnnouncements();
        }
      )
      .subscribe();
  } catch (err) {
    console.warn("Real-time announcements setup failed:", err);
  }
}

async function boot() {
  setupReveal();
  
  const settings = await fetchSettings();
  if (settings.themeId) {
    const theme = await fetchThemeById(settings.themeId);
    if (theme) applyThemeVariables(theme);
  }
  state.settings = settings;
  
  state.user = await getCurrentUserWithRole();
  
  // Fetch announcements
  state.announcements = await fetchAnnouncements();
  renderAnnouncements();
  setupFilters();
  showAdminPanel();
  setupRealTimeAnnouncements();
}

boot();
