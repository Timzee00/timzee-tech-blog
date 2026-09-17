let channel = null;
let activeToasts = [];
let stylesReady = false;
let currentUserId = null;
let notificationPreferences = { messages: true, replies: true, follows: true, mentions: true, announcements: true, marketplace: true };

function injectStyles() {
  if (stylesReady || document.getElementById("timzee-notification-styles")) return;
  stylesReady = true;
  const style = document.createElement("style");
  style.id = "timzee-notification-styles";
  style.textContent = `
    #timzee-notification-region { position: fixed; top: 84px; right: 18px; width: min(390px, calc(100vw - 36px)); display: grid; gap: 10px; z-index: 10050; pointer-events: none; }
    .timzee-notification-toast { pointer-events: auto; display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 14px 14px 13px; border: 1px solid color-mix(in srgb, currentColor 14%, transparent); border-radius: 14px; background: var(--card-solid, #fff); color: var(--ink, #111827); box-shadow: 0 16px 42px rgba(0,0,0,.16); animation: timzeeNotifIn .22s ease-out both; overflow: hidden; }
    .timzee-notification-toast.is-leaving { animation: timzeeNotifOut .18s ease-in both; }
    .timzee-notification-main { min-width: 0; }
    .timzee-notification-title { margin: 0 0 4px; font-size: .94rem; font-weight: 700; line-height: 1.25; }
    .timzee-notification-body { margin: 0; font-size: .86rem; line-height: 1.45; opacity: .82; overflow-wrap: anywhere; }
    .timzee-notification-actions { display: flex; align-items: flex-start; gap: 6px; }
    .timzee-notification-action, .timzee-notification-close { border: 0; background: transparent; color: inherit; cursor: pointer; }
    .timzee-notification-action { font-size: .78rem; font-weight: 700; padding: 5px 7px; border-radius: 8px; text-decoration: none; background: color-mix(in srgb, currentColor 9%, transparent); }
    .timzee-notification-close { width: 28px; height: 28px; border-radius: 8px; font-size: 1.15rem; line-height: 1; }
    .timzee-notification-close:hover, .timzee-notification-action:hover { background: color-mix(in srgb, currentColor 14%, transparent); }
    @keyframes timzeeNotifIn { from { opacity: 0; transform: translateY(-10px) translateX(10px); } to { opacity: 1; transform: translateY(0) translateX(0); } }
    @keyframes timzeeNotifOut { from { opacity: 1; transform: translateY(0); max-height: 220px; } to { opacity: 0; transform: translateY(-8px); max-height: 0; margin-top: -10px; padding-top: 0; padding-bottom: 0; border-width: 0; } }
    @media (prefers-reduced-motion: reduce) { .timzee-notification-toast { animation: none; } }
    @media (max-width: 640px) { #timzee-notification-region { top: 72px; right: 10px; width: calc(100vw - 20px); } }
  `;
  document.head.appendChild(style);
}
function getRegion() {
  let region = document.getElementById("timzee-notification-region");
  if (!region) { region = document.createElement("div"); region.id = "timzee-notification-region"; region.setAttribute("aria-live", "polite"); region.setAttribute("aria-atomic", "false"); document.body.appendChild(region); }
  return region;
}
function safeSameOriginLink(rawLink) {
  if (!rawLink) return null;
  try { const url = new URL(rawLink, window.location.href); return url.origin === window.location.origin ? url.href : null; } catch { return null; }
}
async function markRead(notificationId, userId, supabase) {
  if (!notificationId || !userId || !supabase) return;
  try { await supabase.from("notifications").update({ read_at: new Date().toISOString() }).eq("id", notificationId).eq("user_id", userId).is("read_at", null); } catch {}
}
function removeToast(toast) { if (!toast || !toast.isConnected) return; toast.classList.add("is-leaving"); window.setTimeout(() => toast.remove(), 190); activeToasts = activeToasts.filter((item) => item !== toast); }
function clearToasts() { activeToasts.forEach((toast) => toast.remove()); activeToasts = []; }

function notificationCategory(notification) {
  const type = String(notification?.notification_type || notification?.type || "").toLowerCase();
  if (type.includes("message")) return "messages";
  if (type.includes("reply") || type.includes("comment")) return "replies";
  if (type.includes("follow") || type.includes("friend")) return "follows";
  if (type.includes("mention")) return "mentions";
  if (type.includes("announcement")) return "announcements";
  if (type.includes("market") || type.includes("inquir") || type.includes("listing")) return "marketplace";
  return "replies";
}
function notificationAllowed(notification) { return notificationPreferences[notificationCategory(notification)] !== false; }

function showNotificationToast(notification, userId, supabase) {
  if (!notificationAllowed(notification)) return;
  injectStyles();
  const region = getRegion();
  const toast = document.createElement("article"); toast.className = "timzee-notification-toast"; toast.setAttribute("role", "status");
  const main = document.createElement("div"); main.className = "timzee-notification-main";
  const title = document.createElement("p"); title.className = "timzee-notification-title"; title.textContent = notification?.title || "New notification";
  const body = document.createElement("p"); body.className = "timzee-notification-body"; body.textContent = notification?.body || "You have a new notification."; main.append(title, body);
  const actions = document.createElement("div"); actions.className = "timzee-notification-actions";
  const link = safeSameOriginLink(notification?.link_url || notification?.link);
  if (link) { const action = document.createElement("a"); action.className = "timzee-notification-action"; action.href = link; action.textContent = "Open"; action.addEventListener("click", () => markRead(notification.id, userId, supabase), { once: true }); actions.appendChild(action); }
  const close = document.createElement("button"); close.type = "button"; close.className = "timzee-notification-close"; close.setAttribute("aria-label", "Dismiss notification"); close.textContent = "×";
  close.addEventListener("click", () => { markRead(notification.id, userId, supabase); removeToast(toast); }); actions.appendChild(close);
  toast.append(main, actions); region.prepend(toast); activeToasts.push(toast); while (activeToasts.length > 3) removeToast(activeToasts[0]); window.setTimeout(() => removeToast(toast), 7000);
}

async function loadNotificationPreferences(supabase, userId) {
  notificationPreferences = { messages: true, replies: true, follows: true, mentions: true, announcements: true, marketplace: true };
  try {
    const profile = await supabase.from("profiles").select("notify_messages,notify_replies,notify_follows,notify_mentions").eq("id", userId).maybeSingle();
    if (profile.data) notificationPreferences = { ...notificationPreferences, messages: profile.data.notify_messages !== false, replies: profile.data.notify_replies !== false, follows: profile.data.notify_follows !== false, mentions: profile.data.notify_mentions !== false };
    const settings = await supabase.from("user_settings").select("preferences").eq("user_id", userId).maybeSingle();
    const p = settings.data?.preferences || {};
    notificationPreferences = { ...notificationPreferences, ...(p.notifications || {}) };
  } catch (error) { console.warn("Notification preference load failed:", error); }
}

async function attachForUser(supabase, user) {
  if (!user?.id) return;
  if (currentUserId === user.id && channel) return;
  if (channel) { await supabase.removeChannel(channel); channel = null; }
  currentUserId = user.id;
  await loadNotificationPreferences(supabase, user.id);
  injectStyles();
  channel = supabase.channel(`notification-toasts-${user.id}`)
    .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` }, (payload) => showNotificationToast(payload.new, user.id, supabase))
    .subscribe();
}

async function start() {
  if (typeof window === "undefined" || !document.body || window.__timzeeNotificationUiReady) return;
  window.__timzeeNotificationUiReady = true;
  const supabase = window.supabase; if (!supabase) return;
  injectStyles();
  const handleAuth = async (session) => {
    const user = session?.user || null;
    if (user) await attachForUser(supabase, user);
    else { if (channel) { await supabase.removeChannel(channel); channel = null; } currentUserId = null; clearToasts(); }
  };
  supabase.auth.onAuthStateChange((event, session) => { void handleAuth(session).catch((error) => console.warn("Notification auth lifecycle failed:", error)); });
  try { const { data } = await supabase.auth.getSession(); await handleAuth(data?.session || null); } catch (error) { console.warn("Notification session initialization failed:", error); }
  window.addEventListener("beforeunload", () => { if (channel) supabase.removeChannel(channel); }, { once: true });
}
start().catch((error) => console.error("Notification UI failed to initialize:", error));
