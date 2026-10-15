// Read-only public deployment gate. Usage:
// node scripts/verify-public-release.mjs https://your-deploy-preview.netlify.app <expected-40-char-git-sha>
// Does not sign in, modify records, or call paid APIs.
import { pathToFileURL } from "node:url";

const ROUTES = ["/", "/login.html", "/chat.html", "/stories.html", "/marketplace.html",
  "/discussion.html", "/videos.html", "/novels.html", "/privacy.html"];

export function validateRelease(release, expectedSha = "") {
  if (!release || !/^[0-9a-f]{40}$/i.test(String(release.commit || ""))) {
    return "Missing/invalid release commit in release.json";
  }
  if (expectedSha && release.commit.toLowerCase() !== expectedSha.toLowerCase()) {
    return "Deployed commit does not match the requested release";
  }
  if (!/^[0-9a-f]{16}$/i.test(String(release.asset_version || ""))) {
    return "Missing/invalid asset version";
  }
  return "";
}
export function checkPreviewIndexing(headers, robots) {
  const tag = headers.get("x-robots-tag") || "";
  if (!/noindex/i.test(tag)) return "Preview HTTP response is missing X-Robots-Tag: noindex";
  if (!/^Disallow:\s*\/\s*$/mi.test(robots)) return "Preview robots.txt still allows public indexing";
  return "";
}
export function isPreviewHostname(hostname) {
  return /^(?:deploy-preview-\d+|[a-z0-9-]+)--[a-z0-9-]+\.netlify\.app$/i.test(hostname);
}
export async function checkSite(origin, expectedSha = "") {
  const root = new URL(origin);
  if (root.username || root.password || root.pathname !== "/" || root.search || root.hash) {
    throw Error("Provide only the website origin, not credentials or a page path");
  }
  if (root.protocol !== "https:" && !(
    root.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(root.hostname)
  )) throw Error("Use an HTTPS public origin or local HTTP development server");
  const failures = [];
  const request = async path => {
    const response = await fetch(new URL(path, root), { cache: "no-store", signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw Error(path + ": HTTP " + response.status);
    return response;
  };
  for (const path of ROUTES) {
    try {
      const response = await request(path);
      if (!/text\/html/i.test(response.headers.get("content-type") || "")) failures.push(path + ": not HTML");
      if (path === "/" && isPreviewHostname(root.hostname)) {
        const robots = await (await request("/robots.txt")).text();
        const issue = checkPreviewIndexing(response.headers, robots);
        if (issue) failures.push(issue);
      }
    } catch (error) { failures.push(String(error.message || error)); }
  }
  try {
    const release = await (await request("/release.json")).json();
    const issue = validateRelease(release, expectedSha);
    if (issue) failures.push(issue);
  } catch (error) { failures.push("Release manifest: " + String(error.message || error)); }
  try {
    const health = await (await request("/health")).json();
    if (health.status !== "ok" || health.database !== "ok") failures.push("Health endpoint reports degraded services");
  } catch (error) { failures.push("Health endpoint: " + String(error.message || error)); }
  return { ok: failures.length === 0, failures, pagesChecked: ROUTES.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [origin, expectedSha = ""] = process.argv.slice(2);
  if (!origin) { console.error("Usage: node scripts/verify-public-release.mjs <origin> [expected-commit-sha]"); process.exitCode = 2; }
  else {
    checkSite(origin, expectedSha).then(result => {
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) process.exitCode = 1;
    }).catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
