import { existsSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();
const read = (file) => readFileSync(join(root, file), "utf8");
const fail = (message) => {
  console.error(`Production validation failed: ${message}`);
  process.exit(1);
};

const netlify = read("netlify.toml");
if (!/publish\s*=\s*["']\.["']/.test(netlify)) fail("Netlify publish directory must be the repository root.");
if (!/functions\s*=\s*["']netlify\/functions["']/.test(netlify)) fail("Netlify functions directory is missing.");
if (!/from\s*=\s*["']\/sitemap\.xml["']/.test(netlify) || !/to\s*=\s*["']\/\.netlify\/functions\/sitemap["']/.test(netlify)) fail("Dynamic sitemap rewrite is missing.");
if (!/from\s*=\s*["']\/health["']/.test(netlify) || !/to\s*=\s*["']\/\.netlify\/functions\/health["']/.test(netlify)) fail("Production health rewrite is missing.");

for (const file of [
  "netlify/functions/sitemap.js",
  "netlify/functions/health.js",
  "netlify/functions/chat-media-sign.js",
  "action-result.html",
  "offline.html",
  "maintenance.html",
  "privacy.html",
  "terms.html",
  "refund-policy.html",
  "cookies.html",
  "accessibility.html",
  "assets/js/action-result.js",
  "assets/js/notification-popup.js",
  "assets/js/site-shell.js",
  "assets/js/privacy-consent.js",
  "assets/js/popularity-engine.js",
  "assets/js/chat-v2.js",
  "assets/css/design-system.css",
  "assets/css/chat-v2.css",
  "assets/js/media.js",
  "supabase/migrations/20260917123000_secure_private_chat_media.sql",
  "supabase/migrations/upgrade_chat_groups_and_message_metadata.sql"
]) {
  if (!existsSync(join(root, file))) fail(`Required production surface is missing: ${file}`);
}

const media = read("assets/js/media.js");
if (!media.includes('const CHAT_BUCKET = "chat-media"')) fail("Chat media must use the private chat-media bucket.");
if (!media.includes("requestChatSignedUrl")) fail("Chat media signing helper is missing.");
if (!media.includes('folder === CHAT_FOLDER')) fail("Chat uploads are not routed through the private-media path.");

const chat = read("assets/js/chat-v2.js");
for (const required of ["postgres_changes", "broadcast", "presence", "MediaRecorder", "group-avatars", "data-edit-member-tags"]) {
  if (!chat.includes(required)) fail(`Upgraded chat surface is missing: ${required}`);
}

const headers = read("_headers");
for (const required of [
  "Strict-Transport-Security:",
  "X-Content-Type-Options: nosniff",
  "Referrer-Policy:",
  "Permissions-Policy:",
  "Content-Security-Policy:",
  "X-Frame-Options: SAMEORIGIN"
]) {
  if (!headers.includes(required)) fail(`Missing security header: ${required}`);
}

const robots = read("robots.txt");
const sitemap = read("sitemap.xml");
const sitemapMatch = robots.match(/^Sitemap:\s*(\S+)\s*$/m);
if (!sitemapMatch) fail("robots.txt must declare a sitemap.");
if (!sitemapMatch[1].endsWith("/sitemap.xml")) fail("robots.txt must point to /sitemap.xml.");
if (!sitemap.includes("<loc>https://timzee-tech-blog.netlify.app/</loc>")) fail("Static sitemap fallback is missing the homepage.");

const legal = ["privacy.html", "terms.html", "refund-policy.html", "cookies.html", "accessibility.html"];
for (const file of legal) {
  const text = read(file);
  if (!text.includes("Powered by Timzee Corp")) console.warn(`Warning: ${file} relies on site-shell branding injection.`);
}

const popularity = read("assets/js/popularity-engine.js");
if (!popularity.includes('get_popular_posts')) fail("Homepage popular posts must use the automated database ranking.");

const packageJson = JSON.parse(read("package.json"));
for (const [name, version] of Object.entries(packageJson.dependencies || {})) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) fail(`Dependency ${name} must be pinned to an exact version.`);
}

const scanRoots = ["assets", "netlify/functions"];
const suspicious = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /gsk_[A-Za-z0-9_-]{20,}/,
  /sb_secret_[A-Za-z0-9_-]{20,}/,
  /service_role_[A-Za-z0-9_-]{20,}/,
  /localStorage\.(?:setItem|getItem)\((?:["'])groq_api_key/i,
  /llama-3\.3-70b-versatile/i
];

const walk = async (dir) => {
  const { readdir } = await import("node:fs/promises");
  const entries = await readdir(join(root, dir), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(path)));
    else if (/\.(?:js|mjs|html)$/.test(entry.name)) files.push(path);
  }
  return files;
};

for (const base of scanRoots) {
  for (const file of await walk(base)) {
    const text = read(file);
    for (const pattern of suspicious) {
      if (pattern.test(text)) fail(`Potential client-side secret, obsolete API-key storage, or retired provider model found in ${relative(root, file)}.`);
    }
  }
}

if (!existsSync(join(root, "package-lock.json"))) console.warn("Warning: package-lock.json is not committed yet; generate and commit one on a networked development machine.");

console.log("Production configuration validation passed.");
