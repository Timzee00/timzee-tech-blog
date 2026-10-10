// Add the shared public chrome to built pages, not isolated staff workspaces.
// Centralizing this at build time avoids inconsistencies between page scripts.
export function injectSiteShell(html) {
  const publicChrome = /<(?:header|footer)\b[^>]*\bclass\s*=\s*(["'])[^"']*\b(?:site-header|footer)\b[^"']*\1/i;
  const alreadyLoaded = /<script\b[^>]*\bsrc\s*=\s*(["'])[^"']*\bsite-shell\.js(?:\?[^"']*)?\1/i;
  if (!publicChrome.test(html) || alreadyLoaded.test(html) || !/<\/body\s*>/i.test(html)) return html;
  return html.replace(/<\/body\s*>/i, '    <script type="module" src="/assets/js/site-shell.js"></script>\n  </body>');
}
