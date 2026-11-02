/**
 * Safe, reversible public-media delivery switch.
 * Leave WORKER_ORIGIN empty until R2 activation + Cloudflare Worker deployment
 * are verified. Existing DB URLs and private-media access remain unchanged.
 */
const WORKER_ORIGIN = "";
const PUBLIC_STORAGE_PREFIX =
  "/storage/v1/object/public/media/";
const PUBLIC_HOST = "duvbcwwprkzzyzikmcol.supabase.co";

/** Convert a trusted public Supabase media URL to our R2 Worker read-through URL. */
export function deliveryMediaUrl(rawUrl) {
  const original = typeof rawUrl === "string" ? rawUrl : "";
  if (!original || !WORKER_ORIGIN) return original;
  try {
    const delivery = new URL(WORKER_ORIGIN);
    if (delivery.protocol !== "https:" || delivery.search || delivery.hash ||
        delivery.pathname !== "/" || delivery.username || delivery.password) return original;
    const source = new URL(original);
    if (source.protocol !== "https:" || source.hostname !== PUBLIC_HOST ||
        source.search || source.hash || source.port ||
        !source.pathname.startsWith(PUBLIC_STORAGE_PREFIX)) return original;
    const key = decodeURIComponent(source.pathname.slice(PUBLIC_STORAGE_PREFIX.length));
    if (!/^[-\w./]+$/.test(key) || key.includes("..") ||
        key.startsWith("/") || key.includes("//") ||
        !/\.[a-z0-9]{2,7}$/i.test(key)) return original;
    return delivery.origin + "/media/" + key.split("/").map(encodeURIComponent).join("/");
  } catch {
    return original;
  }
}

export const publicMediaDeliveryEnabled = Boolean(WORKER_ORIGIN);
