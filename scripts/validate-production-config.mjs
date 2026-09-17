import { readFileSync } from "node:fs";
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
if (!sitemap.includes(sitemapMatch[1].replace(/\/sitemap\.xml$/, ""))) {
  fail("robots.txt sitemap URL does not match the sitemap host.");
}
if (/2026-01-25/.test(sitemap)) fail("sitemap.xml still contains the obsolete January 2026 lastmod date.");

for (const requiredPage of [
  "<loc>https://timzee-tech-blog.netlify.app/</loc>",
  "<loc>https://timzee-tech-blog.netlify.app/discussion.html</loc>",
  "<loc>https://timzee-tech-blog.netlify.app/marketplace.html</loc>",
  "<loc>https://timzee-tech-blog.netlify.app/videos.html</loc>",
  "<loc>https://timzee-tech-blog.netlify.app/novels.html</loc>"
]) {
  if (!sitemap.includes(requiredPage)) fail(`sitemap.xml is missing ${requiredPage}`);
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

console.log("Production configuration validation passed.");
