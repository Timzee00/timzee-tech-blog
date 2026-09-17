import { supabase, getCurrentUser } from "./supabase.js";

const BANNER_KEY = "timzee_last_dismissed_announcement";
let announcementChannel = null;
let notificationChannel = null;

function safeRelativeUrl(value) {
  try {
    const url = new URL(String(value || ""), window.location.origin);
    if (url.origin !== window.location.origin) return "";
    if (!["http:", "https:"].includes(url.protocol)) return "";
    return url.pathname + url.search + url.hash;
  } catch {
    return "";
  }
}

function getAnnouncementBody(announcement) {
  return String(announcement?.body ?? announcement?.message ?? "").trim();
}

function isPublishedAnnouncement(announcement, now = Date.now()) {
  const status = String(announcement?.status || "published").toLowerCase();
  if (status !== "published") return false;
  if (!announcement?.publish_at) return true;
  const timestamp = new Date(announcement.publish_at).getTime();
  return Number.isFinite(timestamp) && timestamp <= now;
}

function getAnnouncements() {
  return supabase
    .from("announcements")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(12);
}

function renderAnnouncementBanner(announcement) {
  const existing = document.getElementById("siteAnnouncementBanner");
  if (existing) existing.remove();
  if (!announcement) return;

  const dismissedId = localStorage.getItem(BANNER_KEY);
  if (dismissedId === String(announcement.id)) return;

  const banner = document.createElement("aside");
  banner.id = "siteAnnouncementBanner";
  banner.className = "site-announcement-banner";
  banner.setAttribute("role", "status");

  const content = document.createElement("div");
  content.className = "site-announcement-content";

  const label = document.createElement("span");
  label.className = "site-announcement-label";
  label.textContent = "Announcement";

  const title = document.createElement("strong");
  title.className = "site-announcement-title";
  title.textContent = announcement.title || "Site update";

  const body = document.createElement("span");
  body.className = "site-announcement-body";
  body.textContent = getAnnouncementBody(announcement);

  content.append(label, title, body);

  const actions = document.createElement("div");
  actions.className = "site-announcement-actions";

  const viewLink = document.createElement("a");
  viewLink.className = "site-announcement-link";
  viewLink.href = "announcements.html";
  viewLink.textContent = "View all";

  const dismiss = document.createElement("button");
  dismiss.type = "button";
  dismiss.className = "site-announcement-dismiss";
  dismiss.textContent = "Dismiss";
  dismiss.addEventListener("click", () => {
    localStorage.setItem(BANNER_KEY, String(announcement.id));
    banner.remove();
  });

  actions.append(viewLink, dismiss);
  banner.append(content, actions);
  document.body.prepend(banner);
}

async function refreshAnnouncementBanner({ announceNew = false } = {}) {
  try {
    const { data, error } = await getAnnouncements();
    if (error) throw error;
    const now = Date.now();
    const latest = (data || []).find((item) => isPublishedAnnouncement(item, now) && getAnnouncementBody(item));
    renderAnnouncementBanner(latest || null);
    if (announceNew && latest) {
      window.siteToast?.(getAnnouncementBody(latest), {
        type: "info",
        title: latest.title || "New announcement",
        duration: 6500
      });
    }
  } catch (error) {
    console.warn("Site announcement banner unavailable:", error);
  }
}

async function setupRealtimeNotificationPopups(user) {
  if (!user || notificationChannel) return;
  notificationChannel = supabase
    .channel(`notification-popups-${user.id}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "notifications",
        filter: `user_id=eq.${user.id}`
      },
      (payload) => {
        const item = payload.new || {};
        const link = safeRelativeUrl(item.link_url || item.link);
        const message = String(item.body || item.title || "You have a new notification.").trim();
        const toast = window.siteToast?.(message, {
          type: "info",
          title: item.title || "New notification",
          duration: 7000
        });
        if (toast && link) {
          const content = toast.querySelector(".site-toast-content");
          if (content && !content.querySelector("a")) {
            const action = document.createElement("a");
            action.href = link;
            action.textContent = "Open";
            action.style.cssText = "display:inline-block;margin-top:8px;font-size:.88rem;font-weight:700;color:inherit;text-decoration:underline;";
            content.appendChild(action);
          }
        }
      }
    )
    .subscribe();
}

function setupRealtimeAnnouncements() {
  if (announcementChannel) return;
  announcementChannel = supabase
    .channel("site-announcement-banner")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "announcements"
      },
      () => refreshAnnouncementBanner({ announceNew: true })
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "announcements"
      },
      () => refreshAnnouncementBanner()
    )
    .subscribe();
}

function installStyles() {
  if (document.getElementById("site-notification-popup-style")) return;
  const style = document.createElement("style");
  style.id = "site-notification-popup-style";
  style.textContent = `
    .site-announcement-banner {
      position: relative;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      width: min(1120px, calc(100% - 28px));
      margin: 12px auto 0;
      padding: 12px 14px 12px 16px;
      border: 1px solid rgba(37,99,235,.24);
      border-radius: 14px;
      background: var(--card-solid, #fff);
      color: var(--ink, #171717);
      box-shadow: 0 10px 28px rgba(0,0,0,.08);
    }
    .site-announcement-content { min-width: 0; display: grid; gap: 2px; }
    .site-announcement-label { font-size: .72rem; text-transform: uppercase; letter-spacing: .08em; font-weight: 800; opacity: .68; }
    .site-announcement-title { overflow-wrap: anywhere; }
    .site-announcement-body { color: var(--muted, #626a78); overflow-wrap: anywhere; }
    .site-announcement-actions { display: flex; align-items: center; gap: 8px; flex: 0 0 auto; }
    .site-announcement-link, .site-announcement-dismiss { font: inherit; font-weight: 700; color: inherit; background: transparent; border: 0; cursor: pointer; text-decoration: none; }
    .site-announcement-link:hover, .site-announcement-dismiss:hover, .site-announcement-link:focus-visible, .site-announcement-dismiss:focus-visible { text-decoration: underline; }
    @media (max-width: 700px) {
      .site-announcement-banner { align-items: flex-start; flex-direction: column; gap: 10px; }
      .site-announcement-actions { width: 100%; justify-content: flex-end; }
    }
  `;
  document.head.appendChild(style);
}

export async function initSiteNotifications() {
  installStyles();
  await refreshAnnouncementBanner();
  setupRealtimeAnnouncements();
  const user = await getCurrentUser();
  await setupRealtimeNotificationPopups(user);
}
