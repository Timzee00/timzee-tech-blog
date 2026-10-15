export function previewIndexingHeaders(netlifyContext) {
  if (!["deploy-preview", "branch-deploy"].includes(String(netlifyContext || ""))) return "";
  return "  X-Robots-Tag: noindex, nofollow, noarchive\n";
}
