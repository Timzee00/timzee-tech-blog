import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

let checked = 0;
let failures = 0;
function check(label, code, module) {
  const result = spawnSync(process.execPath, [...(module ? ["--input-type=module"] : []), "--check"], { input: code, encoding: "utf8" });
  checked++;
  if (result.status !== 0) {
    console.error(`${label}\n${result.stderr || result.error}`);
    failures++;
  }
}
function walk(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".git", "dist", ".netlify", "test-results", "playwright-report"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) { walk(path); continue; }
    const code = readFileSync(path, "utf8");
    if (/\.(?:js|mjs|cjs)$/.test(path)) check(path, code, path.startsWith("assets/") || path.endsWith(".mjs"));
    if (path.endsWith(".html")) {
      let index = 0;
      for (const [, attributes, body] of code.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
        index++;
        if (/\bsrc\s*=/i.test(attributes) || !body.trim()) continue;
        const type = attributes.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1];
        if (type && !["module", "text/javascript", "application/javascript"].includes(type)) continue;
        check(`${path}:inline-script-${index}`, body, type === "module");
      }
    }
  }
}
walk(".");
console.log(`Checked ${checked} JavaScript files and inline scripts; ${failures} failures.`);
if (failures) process.exitCode = 1;
