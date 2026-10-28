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
    .select("id,title,body,message,banner_image_url,status,publish_at,created_at")
    .order("created_at", { ascending: false })
    .limit(12);
}

function renderAnnouncementBanner(announcement) {
  // Retire an older announcement presentation when both site scripts load.
  document.getElementById("timzee-announcement-banner")?.remove();
  document.getElementById("siteAnnouncementBackdrop")?.remove();
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
  const visual=typeof announcement.banner_image_url==="string"&&
   /^https:\/\/[^\s<>"']{1,2048}$/i.test(announcement.banner_image_url);
  if(visual)banner.classList.add("site-announcement-banner--visual");
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

  if(visual){
    const image=document.createElement("img");
    image.className="site-announcement-art";
    image.src=announcement.banner_image_url;
    image.alt=title.textContent||"Blipmood announcement artwork";
    image.loading="eager";
    content.append(image);
    if(getAnnouncementBody(announcement))content.append(label,title,body);
  }else content.append(label,title,body);

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
    document.getElementById("siteAnnouncementBackdrop")?.remove();
  });

  actions.append(viewLink, dismiss);
  banner.append(content, actions);
  if(visual){
    const backdrop=document.createElement("div");
    backdrop.id="siteAnnouncementBackdrop";
    backdrop.className="site-announcement-backdrop";
    backdrop.addEventListener("click",()=>dismiss.click());
    document.body.append(backdrop);
    dismiss.textContent="✕";
    dismiss.setAttribute("aria-label","Close graphic announcement");
  }
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
    const latest = (data || []).find((item) => isPublishedAnnouncement(item, now) && (getAnnouncementBody(item)||item.banner_image_url));
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
    .site-announcement-backdrop{position:fixed;inset:0;z-index:97999;background:rgba(3,7,22,.79);backdrop-filter:blur(10px)}
    .site-announcement-banner.site-announcement-banner--visual{
      top:50%;left:50%;right:auto;transform:translate(-50%,-50%);
      width:min(1060px,calc(100vw - 28px));max-width:100%;max-height:calc(100dvh - 38px);
      padding:0;display:block;overflow:auto;background:#090d27;border:1px solid #7c59ff;
      border-radius:24px;box-shadow:0 0 45px #7045ff55,0 34px 85px #0009;
      color:#fff;
    }
    .site-announcement-banner--visual .site-announcement-content{display:block;padding:0;min-width:0}
    .site-announcement-banner--visual .site-announcement-art{display:block;width:100%;height:auto;max-width:100%;max-height:min(72dvh,710px);object-fit:contain}
    .site-announcement-banner--visual .site-announcement-content:has(.site-announcement-body) .site-announcement-body{display:block;font-size:.83rem;line-height:1.5;padding:0 22px 12px;color:#cad8ff}
    .site-announcement-banner--visual .site-announcement-content:has(.site-announcement-body) .site-announcement-title{display:block;padding:9px 22px 0;font-size:1rem}
    .site-announcement-banner--visual .site-announcement-label{display:none}
    .site-announcement-banner--visual .site-announcement-actions{position:sticky;bottom:0;display:flex;flex-direction:row;align-items:center;justify-content:center;gap:9px;padding:12px 18px;background:#070c24ee;min-height:59px}
    .site-announcement-banner--visual .site-announcement-link{min-height:42px;padding:9px 23px;border-radius:25px;font-weight:850;color:#fff;background:linear-gradient(110deg,#2468f1,#aa3edb);text-decoration:none}
    .site-announcement-banner--visual .site-announcement-dismiss{position:absolute;top:5px;right:12px;min-width:39px;min-height:39px;border-radius:50%;color:#fff;background:#ffffff26;font-size:1.3rem}
    @media(max-width:700px){.site-announcement-banner.site-announcement-banner--visual{top:50%;left:50%;right:auto;transform:translate(-50%,-50%);width:calc(100vw - 16px);max-height:calc(100dvh - 24px);padding:0;display:block;border-radius:17px}
      .site-announcement-banner--visual .site-announcement-art{max-height:67dvh;object-fit:contain}
      .site-announcement-banner--visual .site-announcement-actions{width:100%;flex-direction:row;align-items:center;gap:8px}
      .site-announcement-banner--visual .site-announcement-dismiss{top:3px;right:7px}
    }
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
      .site-announcement-banner {
        flex-direction:row;align-items:flex-start;gap:8px;
        max-height:min(136px,24dvh);padding:9px 11px;
      }
      .site-announcement-content{flex:1 1 auto;min-width:0}
      .site-announcement-label{display:none}
      .site-announcement-title{font-size:.83rem;line-height:1.25}
      .site-announcement-body{display:-webkit-box;-webkit-box-orient:vertical;-webkit-line-clamp:2;line-clamp:2;overflow:hidden;font-size:.75rem;line-height:1.4}
      .site-announcement-actions{width:auto;flex:0 0 auto;flex-direction:column;align-items:flex-end;gap:1px}
      .site-announcement-link,.site-announcement-dismiss{font-size:.74rem;padding:3px 5px;min-height:36px;white-space:nowrap}
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
