/**
 * Remove workflow instructions from reader-facing article HTML.
 * Editorial prompts belong in the curator/admin UI, not in public content.
 * Preserve the hidden verified-takeaways payload for the separate takeaway UI.
 * The caller still applies the existing HTML sanitizer after this cleanup.
 */
export function stripEditorialScaffolding(html) {
  let text=String(html??"");
  text=text.replace(/<p\b[^>]*\bclass\s*=\s*["'][^"']*\bcurator-editorial-note\b[^"']*["'][^>]*>[\s\S]*?<\/p\s*>/gi,"");
  text=text.replace(/<p\b[^>]*>\s*<strong\b[^>]*>\s*Editorial roundup draft:\s*<\/strong>[\s\S]*?<\/p\s*>/gi,"");
  text=text.replace(/<p\b[^>]*>\s*<strong\b[^>]*>\s*Editorial status:\s*<\/strong>[\s\S]*?<\/p\s*>/gi,"");
  text=text.replace(/<section\b[^>]*>\s*<h2\b[^>]*>\s*Candidate images:\s*staff review only\s*<\/h2>[\s\S]*?<\/section\s*>/gi,"");
  return text.trim();
}
