const test = require("node:test");
const assert = require("node:assert/strict");
const helper = import("../scripts/inject-site-shell.mjs");

test("every public header loads the shared shell", async () => {
  const { injectSiteShell } = await helper;
  const html = '<!doctype html><body><header class="site-header">Home</header></body>';
  const output = injectSiteShell(html);
  assert.match(output, /<script type="module" src="\/assets\/js\/site-shell\.js"><\/script>/);
  assert.equal((output.match(/site-shell\.js/g) || []).length, 1);
});

test("footer-only public pages receive the same shell", async () => {
  const { injectSiteShell } = await helper;
  assert.match(injectSiteShell("<body><footer class='footer'>Legal</footer></body>"), /site-shell\.js/);
});

test("staff workspaces keep their own layout and scripts", async () => {
  const { injectSiteShell } = await helper;
  const html = '<body><header class="admin-header"></header></body>';
  assert.equal(injectSiteShell(html), html);
});

test("existing shell scripts and repeat injection are left alone", async () => {
  const { injectSiteShell } = await helper;
  const html = '<body><header class="site-header"></header></body>';
  const existing = html.replace("</body>", '<script type="module" src="/assets/js/site-shell.js?v=123"></script></body>');
  assert.equal(injectSiteShell(existing), existing);
  assert.equal(injectSiteShell(injectSiteShell(html)), injectSiteShell(html));
});

test("invalid documents are not rewritten", async () => {
  const { injectSiteShell } = await helper;
  const html = '<header class="site-header">Missing document body</header>';
  assert.equal(injectSiteShell(html), html);
});

test("mobile navbar surfaces Status directly while preserving Theme in drawer",()=>{
 const fs=require("node:fs"),path=require("node:path");
 const nav=fs.readFileSync(path.resolve(__dirname,"../assets/js/nav.js"),"utf8");
 const css=fs.readFileSync(path.resolve(__dirname,"../assets/css/navbar.css"),"utf8");
 assert.ok(nav.includes('className="site-status-quick-link"'));
 assert.ok(nav.includes('href="/stories.html"'));
 assert.ok(nav.includes('siteMenuThemeChip'));
 assert.ok(css.includes('.site-header .wrap>.theme-control{display:none!important}'));
});
