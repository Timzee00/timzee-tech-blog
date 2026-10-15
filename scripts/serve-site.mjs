import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

// Local static preview only; production Functions are served by Netlify.
const root = resolve(import.meta.dirname, "../dist");
const mime = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".xml": "application/xml" };
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = resolve(root, `.${pathname.endsWith("/") ? pathname + "index.html" : pathname}`);
    if (!file.startsWith(root + sep)) throw new Error("Invalid path");
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404); response.end("Not found");
  }
}).listen(5173, "127.0.0.1", () => console.log("Preview: http://127.0.0.1:5173"));
