const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const page = fs.readFileSync("video.html", "utf8");
const playerCss = fs.readFileSync("assets/css/reel-player-reference.css", "utf8");
const navigation = fs.readFileSync("assets/js/blipmood-unified-menu.mjs", "utf8");
const scriptTag = page.match(/<script type="module">([\s\S]*?)<\/script>/);
assert.ok(scriptTag, "Reels module script exists");
const moduleSource = scriptTag[1];
const sourceWithoutImports = moduleSource.replace(
  /(^|\n)\s*import\s+[\s\S]*?\s+from\s+["'][^"']+["'];/g,
  "$1"
);

test("Reels page uses the reference-style top controls and playback dock", () => {
  assert.match(page, /id="reelHeaderBack"/);
  assert.match(page, /id="reelPlayerMenuToggle"/);
  assert.match(page, /class="reel-title-overlay"/);
  assert.match(page, /class="reel-player-dock"/);
  assert.match(page, /data-action="playback"/);
  assert.match(page, /data-action="speed"/);
  assert.match(page, /data-action="volume"/);
  assert.match(page, /data-action="fullscreen"/);
  assert.match(playerCss, /\.reel-player-dock/);
  assert.match(playerCss, /\.reel-player-menu/);
});

test("overflow sheet exposes working options without promising unsupported offline storage", () => {
  for (const label of ["Not interested", "Captions", "Quality", "Auto", "Auto-advance", "Go to Post", "Download video", "Report post"]) {
    assert.ok(page.includes(label), "missing menu label: " + label);
  }
  assert.match(moduleSource, /user_content_feedback/);
  assert.match(moduleSource, /createContentReport/);
  assert.match(moduleSource, /data-menu-action="auto-advance"/);
  assert.match(moduleSource, /data-menu-action="captions"/);
  assert.doesNotMatch(page, /Add to Offline Videos/);
});

test("auto-advance, follow, progress and media controls are connected to real state", () => {
  assert.match(moduleSource, /blipmood:reels-auto-advance/);
  assert.match(moduleSource, /vid\.addEventListener\("ended"/);
  assert.match(moduleSource, /from\("follows"\)/);
  assert.match(moduleSource, /data-action="follow"/);
  assert.match(moduleSource, /requestFullscreen/);
  assert.match(moduleSource, /aria-valuetext/);
  assert.match(moduleSource, /track\?\.addEventListener\("keydown"/);
});

test("reel module JavaScript parses after module imports are removed", () => {
  assert.doesNotThrow(() => new Function(sourceWithoutImports));
});

test("the legacy navigation drawer no longer adds a competing control to Reels", () => {
  assert.match(navigation, /if\(current==="video\.html"\)return;/);
  assert.doesNotMatch(page, /bmReelMenuToggle/);
});