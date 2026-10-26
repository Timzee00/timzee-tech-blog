const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(root,p), "utf8");

test("all built HTML pages receive the Blipmood product name, but stable links and company credit survive", async () => {
  const {injectSiteShell, replaceLegacyBrandText} = await import("../scripts/inject-site-shell.mjs");
  const fixture = '<!doctype html><html><head><title>Timzee Tech Hub</title></head><body>' +
    '<header class="site-header"><a href="https://timzee-tech-blog.netlify.app/">Timzee Tech Blog</a></header>' +
    '<footer class="footer">Timzee Tech Forum · Powered by Timzee Corp</footer></body></html>';
  const out = injectSiteShell(fixture);
  assert.doesNotMatch(out, /Timzee Tech (Hub|Blog|Forum)/);
  assert.match(out, /<title>Blipmood<\/title>/);
  assert.match(out, /Blipmood · Powered by Timzee Corp/);
  assert.match(out, /https:\/\/timzee-tech-blog\.netlify\.app\//);
  assert.match(out, /assets\/brand\/blipmood-mark\.svg/);
  assert.equal((out.match(/site-shell\.js/g)||[]).length,1);
  assert.equal(injectSiteShell(out),out, "injection must be idempotent");
  assert.equal(replaceLegacyBrandText("Timzee Corp"), "Timzee Corp");
  assert.equal(replaceLegacyBrandText('Timzee <span>Tech</span> Hub'), "Blipmood");
});
test("shared site header/footer use a single accessible mark and the approved play-in-i symbol", () => {
  const shell=read("assets/js/site-shell.js");
  const css=read("assets/css/blipmood-brand.css");
  assert.match(shell,/function ensureBlipmoodHeader/);
  assert.match(shell,/function createBlipmoodWordmark/);
  assert.match(shell,/bm-play-i/);
  assert.match(css,/\.bm-play-i/);
  assert.match(shell,/Powered by Timzee Corp/);
  assert.match(shell,/headerBrand\.setAttribute\("aria-label", "Blipmood — Home"\)/);
});
test("new transactional and staff email templates use Blipmood, without changing sender email routing", () => {
  const worker=read("netlify/functions/email-worker.js");
  const staff=read("netlify/functions/_lib/staff-email-template.js");
  const reply=read("netlify/functions/admin-reply-email.js");
  assert.doesNotMatch(worker,/Timzee Tech Hub/);
  assert.match(worker,/sender:\{email:senderEmail,name:senderName\}/);
  assert.match(worker,/BREVO_SENDER_EMAIL/);
  assert.match(worker,/blipmood-mark\.svg/);
  assert.match(staff,/Blipmood/);
  assert.match(reply,/BREVO_REPLY_TO_EMAIL/);
  assert.doesNotMatch(reply,/Timzee Tech Hub/);
});
