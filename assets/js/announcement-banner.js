let bannerReady = false;

function injectStyles() {
  if (document.getElementById("timzee-announcement-banner-styles")) return;
  const style = document.createElement("style");
  style.id = "timzee-announcement-banner-styles";
  style.textContent = `
    #timzee-announcement-banner {
      position: fixed;
      top: 14px;
      left: 50%;
      width: min(760px, calc(100vw - 28px));
      transform: translateX(-50%);
      z-index: 10040;
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 14px;
      align-items: center;
      padding: 14px 16px;
      border: 1px solid color-mix(in srgb, currentColor 14%, transparent);
      border-radius: 16px;
      background: var(--card-solid, #fff);
      color: var(--ink, #111827);
      box-shadow: 0 18px 48px rgba(0,0,0,.16);
    }
    .timzee-announcement-copy { min-width: 0; }
    .timzee-announcement-title { margin: 0 0 3px; font-size: .92rem; font-weight: 800; line-height: 1.25; }
    .timzee-announcement-body { margin: 0; font-size: .84rem; line-height: 1.45; opacity: .82; overflow-wrap: anywhere; }
    .timzee-announcement-actions { display: flex; align-items: center; gap: 7px; }
    .timzee-announcement-open, .timzee-announcement-close { border: 0; color: inherit; cursor: pointer; }
    .timzee-announcement-open { display: inline-flex; align-items: center; justify-content: center; min-height: 32px; padding: 0 10px; border-radius: 9px; background: color-mix(in srgb, currentColor 10%, transparent); font-size: .78rem; font-weight: 800; text-decoration: none; }
    .timzee-announcement-close { width: 30px; height: 30px; border-radius: 9px; background: transparent; font-size: 1.15rem; }
    .timzee-announcement-open:hover, .timzee-announcement-close:hover { background: color-mix(in srgb, currentColor 16%, transparent); }
    @media (max-width: 640px) {
      #timzee-announcement-banner { top: 8px; width: calc(100vw - 16px); grid-template-columns: 1fr; gap: 10px; }
      .timzee-announcement-actions { justify-content: flex-end; }
    }
  `;
  document.head.appendChild(style);
}

function safeSameOriginLink(rawLink) {
  try {
    const url = new URL(rawLink, window.location.href);
    return url.origin === window.location.origin ? url.href : null;
  } catch {
    return null;
  }
}

function dismissedKey(id) {
  return `timzee-announcement-dismissed:${id}`;
}

function wasDismissed(id) {
  try { return localStorage.getItem(dismissedKey(id)) === "1"; } catch { return false; }
}

function dismiss(id, banner) {
  try { localStorage.setItem(dismissedKey(id), "1"); } catch { /* storage may be blocked */ }
  banner.remove();
}

function renderAnnouncement(announcement) {
  if (!announcement?.id || wasDismissed(announcement.id)) return;
  injectStyles();

  const banner = document.createElement("aside");
  banner.id = "timzee-announcement-banner";
  banner.setAttribute("role", "status");
  banner.setAttribute("aria-label", "Site announcement");

  const copy = document.createElement("div");
  copy.className = "timzee-announcement-copy";
  const title = document.createElement("p");
  title.className = "timzee-announcement-title";
  title.textContent = announcement.title || "Announcement";
  const body = document.createElement("p");
  body.className = "timzee-announcement-body";
  body.textContent = announcement.body || announcement.message || "There is a new announcement.";
  copy.append(title, body);

  const actions = document.createElement("div");
  actions.className = "timzee-announcement-actions";
  const open = document.createElement("a");
  open.className = "timzee-announcement-open";
  open.href = safeSameOriginLink("/announcements.html") || "/announcements.html";
  open.textContent = "View";
  actions.appendChild(open);

  const close = document.createElement("button");
  close.type = "button";
  close.className = "timzee-announcement-close";
  close.textContent = "×";
  close.setAttribute("aria-label", "Dismiss announcement");
  close.addEventListener("click", () => dismiss(announcement.id, banner));
  actions.appendChild(close);

  banner.append(copy, actions);
  document.body.appendChild(banner);
}

async function load() {
  if (bannerReady || !document.body || !window.supabase) return;
  bannerReady = true;
  try {
    const { data, error } = await window.supabase
      .from("announcements")
      .select("id,title,body,message,status,publish_at,created_at")
      .eq("status", "published")
      .order("publish_at", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error || !data) return;
    if (data.publish_at && new Date(data.publish_at).getTime() > Date.now()) return;
    renderAnnouncement(data);
  } catch (error) {
    console.warn("Announcement banner failed to load:", error);
  }
}

load();
