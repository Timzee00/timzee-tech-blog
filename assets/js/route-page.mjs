/** Normalize user-facing Netlify clean URLs and legacy .html page links. */
export function pageFileName(pathname = "/") {
  const pieces = String(pathname || "/").split(/[?#]/, 1)[0].split("/");
  const segment = pieces.filter(Boolean).at(-1) || "index.html";
  const normalized = segment.toLowerCase();
  return normalized.includes(".") ? normalized : `${normalized}.html`;
}
