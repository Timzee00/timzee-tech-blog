// Rebrand display copy in built HTML without changing old URLs, data IDs or
// the parent-company credit (Timzee Corp). Public content and staff chrome
// share the same visible product name; app-owned names remain unchanged.
export function replaceLegacyBrandText(html) {
  return html.replace(/Timzee\s*<span>\s*Tech\s*<\/span>\s*Hub/g, "Blipmood")
    .replace(/Timzee Tech (?:Hub|Blog|Forum)\b/g, "Blipmood")
    .replace(/\bTimzee Tech\b/g, "Blipmood");
}
// Add the shared public chrome to built pages, not isolated staff workspaces.
// Centralizing this at build time avoids inconsistencies between page scripts.
export function injectSiteShell(html) {
  const publicChrome = /<(?:header|footer)\b[^>]*\bclass\s*=\s*(["'])[^"']*\b(?:site-header|footer)\b[^"']*\1/i;
  const alreadyLoaded = /<script\b[^>]*\bsrc\s*=\s*(["'])[^"']*\bsite-shell\.js(?:\?[^"']*)?\1/i;
  html = replaceLegacyBrandText(html);
  if (/<\/head\s*>/i.test(html) && !/rel=["']icon["']/i.test(html)) {
    html = html.replace(/<\/head\s*>/i,
      '  <link rel="icon" type="image/svg+xml" href="/assets/brand/blipmood-mark.svg">\n</head>');
  }
  if (!publicChrome.test(html) || alreadyLoaded.test(html) || !/<\/body\s*>/i.test(html)) return html;
  return html.replace(/<\/body\s*>/i, '    <script type="module" src="/assets/js/site-shell.js"></script>\n  </body>');
}
