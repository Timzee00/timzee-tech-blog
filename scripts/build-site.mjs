import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { build } from "esbuild";
import { injectSiteShell } from "./inject-site-shell.mjs";
import { injectSocialDefaults } from "./inject-social-meta.mjs";
import { previewIndexingHeaders } from "./preview-indexing.mjs";
import {downloadBrandAssets,useLocalBrandAssetUrls} from "./brand-assets.mjs";
import {createPwaIcons,createResponsiveEmblemAssets} from "./build-pwa-icons.mjs";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

// Only public assets belong in the CDN bundle. Never publish the repository,
// migrations, server source, dependency tree, or operational reports.
for (const entry of await readdir(root)) {
  if (entry.endsWith(".html") || ["_headers", "robots.txt", "sitemap.xml", "sw.js", "app.webmanifest"].includes(entry)) {
    await cp(resolve(root, entry), resolve(output, entry));
  }
}
for (const directory of ["assets", "admin", "author", "moderator", "super"]) {
  await cp(resolve(root, directory), resolve(output, directory), { recursive: true });
}
await mkdir(resolve(output, "assets/vendor"), { recursive: true });
// DOMPurify's distributed module is unminified. Ship an optimized ESM
// build while preserving the separate license and its exported API.
await build({
  entryPoints: [resolve(root, "node_modules/dompurify/dist/purify.es.mjs")],
  bundle: false, minify: true, format: "esm", platform: "browser",
  target: "es2022", outfile: resolve(output, "assets/vendor/purify.es.mjs"),
  legalComments: "none"
});
await cp(resolve(root, "node_modules/dompurify/LICENSE"), resolve(output, "assets/vendor/DOMPurify-LICENSE.txt"));
await build({
  stdin: { contents: 'export { createClient } from "@supabase/supabase-js";', resolveDir: root },
  bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true,
  outfile: resolve(output, "assets/vendor/supabase.mjs"),
  legalComments: "linked"
});

// Resolve the CSS import graph at build time instead of making every visitor
// download two dozen serial stylesheets. Keep the source modules maintainable.
await build({
  entryPoints: [resolve(root, "assets/css/styles.css"), resolve(root, "assets/css/styles-home.css"), resolve(root, "assets/css/admin.css")],
  bundle: true, minify: true, target: ["chrome110", "safari16.4", "firefox115"],
  outdir: resolve(output, "assets/css"), legalComments: "none"
});

async function filesIn(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    files.push(...(entry.isDirectory() ? await filesIn(path) : [path]));
  }
  return files.sort();
}
const files = await filesIn(output);
// Netlify deploy-preview/branch-deploy share CDN routes but should not compete
// with production in search results. Production and local builds are unchanged.
const previewHeaders = previewIndexingHeaders(process.env.CONTEXT);
if (previewHeaders) {
  const existingHeaders = await readFile(resolve(output, "_headers"), "utf8");
  if (!/^\/\*\r?\n/m.test(existingHeaders)) throw new Error("Site-wide security headers were not found.");
  // Add to the EXISTING site-wide header block, rather than competing with a
  // duplicate /* rule that may behave differently across hosting adapters.
  await writeFile(resolve(output, "_headers"), existingHeaders.replace(/^\/\*\r?\n/m, matched => matched + previewHeaders));
  await writeFile(resolve(output, "robots.txt"), "User-agent: *\nDisallow: /\n");
}
// Ensure every public page receives the same design chrome, working cookie
// preferences and shared controls, including routes with inline page scripts.
// Staff workspaces have separate layouts and are intentionally excluded.
for (const file of files.filter(path => path.endsWith(".html"))) {
  const original = await readFile(file, "utf8");
  const relativePath = file.slice(output.length + 1);
  const chrome = injectSiteShell(original);
  let enhanced = injectSocialDefaults(chrome, relativePath);
  // Cover shell-less public HTML too, without loading analytics for staff pages.
  const staff = ["admin/","author/","moderator/","super/"].some(prefix =>
    relativePath.startsWith(prefix));
  // A single push-compatible service worker makes the public app installable.
  // Register only after load/idle; do not add offline caching to staff pages.
  if (!staff && enhanced.includes("</head>") && !/rel=["']manifest["']/.test(enhanced)) {
    enhanced = enhanced.replace("</head>",
      '  <link rel="manifest" href="/app.webmanifest">\n' +
      '  <meta name="apple-mobile-web-app-capable" content="yes">\n' +
      '  <meta name="apple-mobile-web-app-title" content="Blipmood">\n</head>');
  }
  if (!staff && enhanced.includes("</body>") && !enhanced.includes("pwa-register.mjs")) {
    enhanced = enhanced.replace("</body>",
      '  <script type="module" src="/assets/js/pwa-register.mjs"></script>\n</body>');
  }
  if (!staff && enhanced.includes("</body>") &&
      !enhanced.includes('src="/assets/js/visitor-analytics.js"')) {
    enhanced = enhanced.replace("</body>",
      '  <script type="module" src="/assets/js/visitor-analytics.js"></script>' + "\n</body>");
  }
  if (enhanced !== original) await writeFile(file, enhanced);
}
// Include the exact user-approved artwork in the first-party published bundle.
// Source media is checksum-pinned: never ship a truncated or tampered image.
await downloadBrandAssets(output);
await createPwaIcons(output);
await createResponsiveEmblemAssets(output);
// Replace the immutable media sources with first-party URLs after copying assets.
// In source mode, remote URLs remain valid for local previews and link validation.
for (const file of await filesIn(output)) {
  if (!/\.(?:html|js|mjs|css)$/.test(file)) continue;
  const before=await readFile(file,"utf8");
  const after=useLocalBrandAssetUrls(before);
  if(after!==before)await writeFile(file,after);
}
const publishedFiles=await filesIn(output);
const hash = createHash("sha256");
for (const file of publishedFiles) hash.update(await readFile(file));
const assetVersion = hash.digest("hex").slice(0, 16);
// Each deploy gets a fresh static-cache namespace, avoiding stale scripts.
const workerPath=resolve(output,"sw.js");
await writeFile(workerPath,(await readFile(workerPath,"utf8"))
  .replaceAll("__BLIPMOOD_ASSET_VERSION__",assetVersion));
// The homepage uses the original verified emblem, resized for narrow phones.
// Source HTML keeps canonical artwork URLs for prebuild link verification.
function optimizeHomeHero(html,version){
 const attrs='sizes="(max-width:760px) 39vw, (max-width:1200px) 35vw, 420px"';
 const srcset=[
   '/assets/brand/blipmood-emblem-dark-180.png?v='+version+' 180w',
   '/assets/brand/blipmood-emblem-dark-420.png?v='+version+' 420w'
 ].join(', ');
 const imagePattern=/<img\b(?=[^>]*data-bm-logo="emblem")(?=[^>]*fetchpriority="high")[^>]*>/i;
 if(!imagePattern.test(html))throw new Error("Homepage LCP emblem missing.");
 html=html.replace(imagePattern,tag=>{
  if(!/src="\/assets\/brand\/blipmood-emblem-dark\.png"/.test(tag))
   throw new Error("Homepage hero must use the verified dark emblem.");
  return tag.replace('src="/assets/brand/blipmood-emblem-dark.png"',
   'src="/assets/brand/blipmood-emblem-dark-420.png?v='+version+
   '" data-bm-responsive-hero="true" srcset="'+srcset+'" '+attrs);
 });
 const preload=/<link rel="preload" href="\/assets\/brand\/blipmood-emblem-dark\.png" as="image" fetchpriority="high">/;
 if(!preload.test(html))throw new Error("Homepage emblem preload missing.");
 return html.replace(preload,
  '<link rel="preload" as="image" href="/assets/brand/blipmood-emblem-dark-420.png?v='+
  version+'" imagesrcset="'+srcset+'" imagesizes="(max-width:760px) 39vw, (max-width:1200px) 35vw, 420px" fetchpriority="high">');
}

// Old deployments marked stable URLs immutable for a year. Version every local
// JS/CSS reference (including module and CSS imports) to escape those caches.
for (const file of publishedFiles.filter(path => /\.(?:html|js|mjs|css)$/.test(path))) {
  let contents = await readFile(file, "utf8");
  if (file === resolve(output,"index.html")) {
    contents=optimizeHomeHero(contents,assetVersion);
    // Swap only the public homepage to the slim CSS bundle; every other
    // Blipmood route retains all its original page-specific styles.
    const fullCss='href="assets/css/styles.css"';
    if(!contents.includes(fullCss))throw new Error("Homepage shared stylesheet missing");
    contents=contents.replace(fullCss,'href="assets/css/styles-home.css"');
  }
  const versioned = contents.replace(/(["'])([^"'\s<>]+\.(?:js|mjs|css|png|svg|webp))\1/g, (match, quote, path) => {
    if (/^(?:[a-z]+:|\/\/)/i.test(path)) return match;
    const local = path.startsWith("/") ? resolve(output, `.${path}`) : resolve(dirname(file), path);
    if (!existsSync(local) && !existsSync(resolve(output, path))) return match;
    return `${quote}${path}?v=${assetVersion}${quote}`;
  });
  await writeFile(file, versioned);
}

let commit = process.env.COMMIT_REF || "";
if (!commit) {
  try { commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(); }
  catch { commit = "unknown"; }
}
await writeFile(resolve(output, "release.json"), JSON.stringify({ commit, asset_version: assetVersion, built_at: new Date().toISOString() }) + "\n");
console.log("Built public site in dist/.");
