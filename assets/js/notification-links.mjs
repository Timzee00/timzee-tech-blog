/**
 * Notifications can contain URLs supplied by other users or integrations.
 * Only accept links staying on this installation's origin, and return a
 * normalized relative path safe to put through HTML attribute escaping.
 */
export function safeNotificationPath(raw, currentOrigin) {
  if (typeof raw !== "string" || !raw.trim()) return "";
  const input = raw.trim();
  if (input.startsWith("//") || input.includes("\\") || /[\u0000-\u001f\u007f]/.test(input)) return "";
  try {
    const base = new URL(currentOrigin);
    const target = new URL(input, base.origin + "/");
    if (!["http:", "https:"].includes(target.protocol) || target.origin !== base.origin) return "";
    if (target.username || target.password) return "";
    return target.pathname + target.search + target.hash;
  } catch {
    return "";
  }
}
