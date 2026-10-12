const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("all public pages use the same canonical design token stylesheet", () => {
  for (const page of ["index.html","login.html","stories.html","discussion.html","profile.html","marketplace.html","videos.html","novels.html","settings.html"]) {
    assert.match(read(page), /assets\/css\/styles\.css/, page);
  }
  const styles = read("assets/css/styles.css");
  assert.match(styles, /@import url\("variables.css"\)/);
  assert.match(styles, /@import url\("design-system.css"\)/);
});

test("editorial and staff CSS both consume the same semantic design tokens", () => {
  const vars = read("assets/css/variables.css");
  const admin = read("assets/css/admin.css");
  const design = read("assets/css/design-system.css");
  for (const token of ["--color-bg","--color-surface","--color-primary","--color-text","--color-border","--font-body","--font-display"]) assert.ok(vars.includes(token), token);
  assert.match(admin, /@import url\("variables.css"\)/);
  assert.match(admin, /@import url\("design-system.css"\)/);
  assert.match(design, /#timzee-consent-banner\s*\{\s*position: relative !important; bottom: auto !important/);
});

test("community, stories and profile each provide a meaningful primary heading", () => {
  assert.match(read("stories.html"), /<h1>Stories<\/h1>/);
  assert.match(read("discussion.html"), /<h1>Communities<\/h1>/);
  assert.match(read("profile.html"), /<h1 id="profileName">/);
});


test("all public pages expose one primary heading and a skip-to-main link", () => {
  const publicPages = fs.readdirSync(root).filter(file => file.endsWith(".html"));
  for (const file of publicPages) {
    const html = read(file);
    assert.equal((html.match(/<h1\b/gi) || []).length, 1, file + " should have one H1");
    assert.match(html, /class="skip-link"\s+href="#main-content"/i, file);
    assert.match(html, /<main\b[^>]*\bid="main-content"/i, file);
  }
});

test("Stories creator is a real button and story author data cannot inject HTML attributes", () => {
  const html = read("stories.html");
  const script = read("assets/js/stories.js");
  assert.match(html, /<button[^>]+id="addStoryBtn"/);
  assert.match(html, /<button[^>]+id="createStatusAction"[^>]*hidden/);
  assert.match(html, /const el = document\.createElement\("button"\)/);
  assert.match(html, /label\.textContent = name/);
  assert.match(html, /image\.src = isSafeUrl/);
  assert.doesNotMatch(html, /<img src="\\$\{isSafeUrl\(profile/);
  assert.doesNotMatch(script, /ensureStoryCreationUI/);
});

test("immersive video player escapes external media attributes and names its actions", () => {
  const html = read("video.html");
  assert.match(html, /poster="\\$\{escapeHTML\(poster\)\}"/);
  assert.match(html, /src="\\$\{escapeHTML\(src\)\}"/);
  for (const action of ["like", "comment", "share", "download"]) {
    assert.match(html, new RegExp('aria-label="[^"]+" class="reel-chip" data-action="' + action + '"'));
  }
});
