/**
 * Cloudflare Workers Free media canary.
 * OFF for ordinary users until real browser + deletion/fallback tests pass.
 * No R2, no paid features, no new upload permissions. Public Supabase URLs in
 * the database remain canonical so disabling the feature is instant.
 */
const WORKER_ORIGIN = "https://blipmood-free-media.blipmood-timzee.workers.dev";
const WORKER_ENABLED_BY_DEFAULT = false;
const PUBLIC_STORAGE_PREFIX = "/storage/v1/object/public/media/";
const PUBLIC_ORIGIN = "https://duvbcwwprkzzyzikmcol.supabase.co";
const PUBLIC_FOLDERS = new Set([
  "videos", "video-thumbnails", "topics", "avatars", "covers",
  "marketplace", "post-media", "community-threads", "community-replies",
  "comments", "discussion", "ads", "group-avatars"
]);

function canaryEnabled() {
  if (WORKER_ENABLED_BY_DEFAULT) return true;
  if (typeof window === "undefined") return false;
  try {
    const value = new URLSearchParams(window.location.search).get("blipmood_cache_canary");
    if (value === "0") {
      sessionStorage.removeItem("blipmood:cache-canary");
      return false;
    }
    if (value === "1") {
      sessionStorage.setItem("blipmood:cache-canary", "1");
      return true;
    }
    return sessionStorage.getItem("blipmood:cache-canary") === "1";
  } catch { return false; }
}

function publicKey(rawUrl) {
  try {
    const u = new URL(rawUrl);
    if (u.protocol !== "https:" || u.host !== new URL(PUBLIC_ORIGIN).host ||
        u.username || u.password || u.search || u.hash ||
        !u.pathname.startsWith(PUBLIC_STORAGE_PREFIX)) return null;
    const key = decodeURIComponent(u.pathname.slice(PUBLIC_STORAGE_PREFIX.length));
    if (key.length > 480 || key.length < 5 || key.includes("..") ||
        key.includes("//") || key.startsWith("/") ||
        !/^[-\w./]+$/.test(key) ||
        !/\.[a-z0-9]{2,7}$/i.test(key) ||
        key.split("/").length < 2 ||
        !PUBLIC_FOLDERS.has(key.split("/")[0])) return null;
    return key;
  } catch { return null; }
}

/** Convert only safe public Supabase URLs to a confirmed Cloudflare route. */
export function deliveryMediaUrl(rawUrl) {
  const original = typeof rawUrl === "string" ? rawUrl : "";
  if (!original || !canaryEnabled()) return original;
  const key = publicKey(original);
  if (!key) return original;
  return WORKER_ORIGIN + "/media/" + key.split("/").map(encodeURIComponent).join("/");
}

// Fail open to the canonical Supabase URL on Worker failure or Free quota
// exhaustion. Only erroring public IMG/VIDEO media is retried, once.
if (typeof document !== "undefined") {
  document.addEventListener("error", event => {
    const element = event.target;
    if (!element || !["IMG", "VIDEO"].includes(element.tagName) ||
        element.dataset?.blipmoodMediaFallback === "1") return;
    const current = element.currentSrc || element.src;
    let u;
    try { u = new URL(current); } catch { return; }
    if (u.origin !== WORKER_ORIGIN || !u.pathname.startsWith("/media/")) return;
    let key;
    try { key = decodeURIComponent(u.pathname.slice(7)); } catch { return; }
    if (!key || !PUBLIC_FOLDERS.has(key.split("/")[0]) ||
        key.includes("..") || !/^[-\w./]+$/.test(key)) return;
    const oldUrl = PUBLIC_ORIGIN + PUBLIC_STORAGE_PREFIX +
      key.split("/").map(encodeURIComponent).join("/");
    element.dataset.blipmoodMediaFallback = "1";
    element.src = oldUrl;
    if (element.tagName === "VIDEO") element.load();
  }, true);
}

export const publicMediaDeliveryEnabled = WORKER_ENABLED_BY_DEFAULT;
