export function previewIndexingHeaders(netlifyContext) {
  if (!["deploy-preview", "branch-deploy"].includes(String(netlifyContext || ""))) return "";
  return "\n/*\n  X-Robots-Tag: noindex, nofollow, noarchive\n";
}
