import { supabase } from "./supabase.js";
import { loadUserPreferences } from "./user-preferences.js";

const BANNER_KEY = "timzee_last_dismissed_announcement";
let announcementChannel = null;
let announcementRequest = 0;
let displayedAnnouncementId = null;
let showAnnouncementBanners = true;

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
    .select("id,title,body,message,status,publish_at,created_at")
    .order("created_at", { ascending: false })
    .limit(12);
}

function renderAnnouncementBanner(announcement) {
  // Retire an older announcement presentation when both site scripts load.
  document.getElementById("timzee-announcement-banner")?.remove();
  const existing = document.getElementById("siteAnnouncementBanner");
  if (existing) existing.remove();
  displayedAnnouncementId = announcement?.id ? String(announcement.id) : null;
  if (!announcement) return;

  let dismissedId = "";
  try { dismissedId = localStorage.getItem(BANNER_KEY) || ""; } catch (_) { /* private mode */ }
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
    try { localStorage.setItem(BANNER_KEY, String(announcement.id)); } catch (_) { /* private mode */ }
    banner.remove();
  });

  actions.append(viewLink, dismiss);
  banner.append(content, actions);
  // A late network response must not push the entire page down on mobile.
  // Render as a dismissible, independently scrollable overlay.
  document.body.append(banner);
}

async function refreshAnnouncementBanner({ announceNew = false } = {}) {
  const request = ++announcementRequest;
  if(!showAnnouncementBanners){
    renderAnnouncementBanner(null);
    return;
  }
  try {
    const { data, error } = await getAnnouncements();
    if (request !== announcementRequest) return; // Ignore older realtime responses.
    if (error) throw error;
    const now = Date.now();
    const latest = (data || []).find((item) => isPublishedAnnouncement(item, now) && getAnnouncementBody(item));
    const previousId = displayedAnnouncementId;
    renderAnnouncementBanner(latest || null);
    // Future/draft events should not repeat a toast about an older item.
    if (announceNew && latest && previousId && previousId !== String(latest.id) &&
        document.getElementById("siteAnnouncementBanner")) {
      window.siteToast?.(getAnnouncementBody(latest), {
        type: "info",
        title: latest.title || "New announcement",
        duration: 6500
      });
    }
  } catch (error) {
    if (request === announcementRequest) console.warn("Site announcement banner unavailable:", error);
  }
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
      position: fixed;
      top: calc(var(--site-header-height, 74px) + 12px);
      right: 16px;
      left: auto;
      z-index: 98000;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      box-sizing: border-box;
      width: min(440px, calc(100vw - 32px));
      max-height: min(270px, 38dvh);
      overflow-y: auto;
      overscroll-behavior: contain;
      margin: 0;
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
    .site-announcement-link, .site-announcement-dismiss { display: inline-flex; align-items: center; justify-content: center; min-height: 44px; padding: 7px 9px; font: inherit; font-weight: 700; color: inherit; background: transparent; border: 0; border-radius: 9px; cursor: pointer; text-decoration: none; }
    .site-announcement-link:hover, .site-announcement-dismiss:hover, .site-announcement-link:focus-visible, .site-announcement-dismiss:focus-visible { text-decoration: underline; }
    @media (max-width: 700px) {
      .site-announcement-banner {
        position: fixed;
        top: calc(var(--site-header-height, 74px) + 8px);
        left: 12px;
        right: 12px;
        width: calc(100vw - 24px);
        max-height: min(230px, 33dvh);
        align-items: stretch;
        flex-direction: column;
        gap: 10px;
      }
      .site-announcement-actions { width: 100%; justify-content: flex-end; }
    }
  `;
  document.head.appendChild(style);
}

export async function initSiteNotifications() {
  installStyles();
  // Preference is hydrated from the same server-backed settings store.
  // Critical account emails are not managed by this optional banner filter.
  try{
    const preferences=await loadUserPreferences();
    showAnnouncementBanners=preferences.notifications?.announcements!==false;
  }catch(error){
    console.warn("Announcement preferences unavailable",error);
  }
  window.addEventListener("timzee:preferences",event=>{
    const enabled=event.detail?.notifications?.announcements!==false;
    if(enabled===showAnnouncementBanners)return;
    showAnnouncementBanners=enabled;
    void refreshAnnouncementBanner();
  });
  await refreshAnnouncementBanner();
  setupRealtimeAnnouncements();
}
