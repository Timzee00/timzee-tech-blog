import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";

const root = process.cwd();
const directories = [".", "admin", "author", "moderator", "super"];
const allowedFile = /\.(?:html|js|mjs|css|svg|png|jpe?g|webp|gif|ico|json|woff2?)$/i;
const problems = [];
let pages = 0;
let links = 0;

for (const directory of directories) {
  const absolute = resolve(root, directory);
  if (!existsSync(absolute)) continue;
  for (const name of readdirSync(absolute)) {
    if (!name.endsWith(".html")) continue;
    const file = resolve(absolute, name);
    if (!statSync(file).isFile()) continue;
    pages++;
    const markup = readFileSync(file, "utf8");
    if (!/name=["']viewport["'][^>]*width=device-width|content=["'][^"']*width=device-width[^"']*["'][^>]*name=["']viewport/i.test(markup)) {
      problems.push(name + ": missing responsive viewport metadata");
    }
    if (!/<title>[^<]+<\/title>/i.test(markup)) {
      problems.push(name + ": missing page title");
    }
    for (const match of markup.matchAll(/\b(?:src|href)\s*=\s*["']([^"']+)["']/gi)) {
      const reference = match[1];
      const pathname = reference.split(/[?#]/)[0];
      if (!pathname || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(pathname) || !allowedFile.test(pathname)) continue;
      let relativePath;
      try { relativePath = decodeURIComponent(pathname); }
      catch { problems.push(name + ": invalid URL encoding in " + reference); continue; }
      const target = relativePath.startsWith("/")
        ? resolve(root, "." + relativePath)
        : resolve(dirname(file), relativePath);
      links++;
      if ((!target.startsWith(root + sep) && target !== root) || !existsSync(target) || !statSync(target).isFile()) {
        problems.push(name + ": missing local asset/page " + reference);
      }
    }
  }
}
if (pages === 0) problems.push("No HTML pages were inspected.");
if (problems.length) {
  problems.forEach(message => console.error("Page integrity: " + message));
  process.exitCode = 1;
} else {
  console.log("Page integrity: " + pages + " pages and " + links + " local references verified.");
}
