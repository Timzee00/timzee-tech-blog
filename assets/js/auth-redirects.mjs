/** Auth callbacks must return to the origin that initiated sign-in.
 * Supabase must explicitly allowlist each trusted deployment origin. */
export function getAuthRedirectOrigin(runningOrigin, productionOrigin) {
  try {
    const candidate = new URL(String(runningOrigin || ""));
    const loopback = ["localhost","127.0.0.1","[::1]"].includes(candidate.hostname);
    if (candidate.username || candidate.password) throw Error("Credential-bearing URL");
    if (candidate.protocol === "https:" || (candidate.protocol === "http:" && loopback)) return candidate.origin;
  } catch { /* Fall back to the configured production origin. */ }
  return new URL(productionOrigin).origin;
}

/** Never redirect a successful sign-in to a foreign origin or a protocol-relative URL. */
export function safeAuthNext(rawNext, currentOrigin) {
  if (!rawNext) return "index.html";
  try {
    const origin = new URL(currentOrigin).origin;
    const raw = String(rawNext).trim();
    if (raw.startsWith("//") || raw.startsWith("\\\\") || /[\\\u0000-\u001f]/.test(raw)) return "index.html";
    // Only fully qualified HTTP(S) URLs are allowed; reject malformed or
    // encoded schemes such as https:%2f%2fexample before URL normalization.
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw) && !/^https?:\\/\\//i.test(raw)) return "index.html";
    const candidate = new URL(raw, origin + "/");
    if (candidate.origin !== origin || !["http:","https:"].includes(candidate.protocol)) return "index.html";
    const path = candidate.pathname + candidate.search + candidate.hash;
    return path.startsWith("/") ? path.slice(1) || "index.html" : "index.html";
  } catch {
    return "index.html";
  }
}

export function makeAuthRedirect(origin, next = "index.html") {
  const target = new URL("/login.html", origin);
  const safeNext = safeAuthNext(next, origin);
  if (safeNext !== "index.html") target.searchParams.set("next", safeNext);
  return target.toString();
}
