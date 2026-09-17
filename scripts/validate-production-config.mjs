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
if (!/from\s*=\s*["']\/sitemap\.xml["']/.test(netlify) || !/to\s*=\s*["']\/\.netlify\/functions\/sitemap["']/.test(netlify)) {
  fail("Dynamic sitemap rewrite is missing.");
}
if (!/from\s*=\s*["']\/health["']/.test(netlify) || !/to\s*=\s*["']\/\.netlify\/functions\/health["']/.test(netlify)) {
  fail("Production health rewrite is missing.");
}
if (!existsSync(join(root, "netlify/functions/sitemap.js"))) fail("Dynamic sitemap function is missing.");
if (!existsSync(join(root, "netlify/functions/health.js"))) fail("Production health function is missing.");

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
if (!sitemap.includes("<loc>https://timzee-tech-blog.netlify.app/</loc>")) {
  fail("Static sitemap fallback is missing the homepage.");
}

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
  /localStorage\.(?:setItem|getItem)\((?:["'])groq_api_key/i
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
      if (pattern.test(text)) fail(`Potential client-side secret or obsolete API-key storage found in ${relative(root, file)}.`);
    }
  }
}

if (!existsSync(join(root, "package-lock.json"))) {
  console.warn("Warning: package-lock.json is not committed yet; generate and commit one on a networked development machine.");
}

console.log("Production configuration validation passed.");
