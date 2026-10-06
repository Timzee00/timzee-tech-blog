import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

// Only public assets belong in the CDN bundle. Never publish the repository,
// migrations, server source, dependency tree, or operational reports.
for (const entry of await readdir(root)) {
  if (entry.endsWith(".html") || ["_headers", "robots.txt", "sitemap.xml"].includes(entry)) {
    await cp(resolve(root, entry), resolve(output, entry));
  }
}
for (const directory of ["assets", "admin", "author", "moderator", "super"]) {
  await cp(resolve(root, directory), resolve(output, directory), { recursive: true });
}
await mkdir(resolve(output, "assets/vendor"), { recursive: true });
await cp(resolve(root, "node_modules/dompurify/dist/purify.es.mjs"), resolve(output, "assets/vendor/purify.es.mjs"));
await cp(resolve(root, "node_modules/dompurify/LICENSE"), resolve(output, "assets/vendor/DOMPurify-LICENSE.txt"));
await build({
  stdin: { contents: 'export { createClient } from "@supabase/supabase-js";', resolveDir: root },
  bundle: true, format: "esm", platform: "browser", target: "es2022", minify: true,
  outfile: resolve(output, "assets/vendor/supabase.mjs"),
  legalComments: "linked"
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
const hash = createHash("sha256");
for (const file of files) hash.update(await readFile(file));
const assetVersion = hash.digest("hex").slice(0, 16);
// Old deployments marked stable URLs immutable for a year. Version every local
// JS/CSS reference (including module and CSS imports) to escape those caches.
for (const file of files.filter(path => /\.(?:html|js|mjs|css)$/.test(path))) {
  const contents = await readFile(file, "utf8");
  const versioned = contents.replace(/(["'])([^"'\s<>]+\.(?:js|mjs|css))\1/g, (match, quote, path) => {
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
