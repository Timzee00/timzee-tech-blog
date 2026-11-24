const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = file => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("homepage light theme overrides the later neon dark palette", () => {
  const entry = read("assets/css/styles-home.css");
  const neon = entry.indexOf('blipmood-neon-experience.css');
  const light = entry.indexOf('blipmood-home-light-theme.css');
  assert.ok(neon >= 0 && light > neon, "light overrides must load after neon styling");
  const css = read("assets/css/blipmood-home-light-theme.css");
  assert.match(css, /:root\[data-theme="light"\] body\.blipmood-home/);
  assert.match(css, /background:#f5f8f8;color:#172b32/);
  assert.match(css, /\.site-header/);
  assert.match(css, /#latestPosts \.post-card/);
});

test("For You video previews load metadata only near the viewport", () => {
  const fyp = read("assets/js/fyp.js");
  assert.match(fyp, /IntersectionObserver/);
  assert.match(fyp, /rootMargin:"320px 0px"/);
  assert.match(fyp, /video\.preload="metadata"/);
  assert.match(fyp, /loadeddata/);
  assert.match(fyp, /limit = 20/);
  assert.match(fyp, /p_limit: limit/);
  assert.doesNotMatch(fyp, /<video[^>]*loading="lazy"/);
});

test("Reels prepare a visible preview and keep active audio state consistent", () => {
  const reels = read("video.html");
  assert.match(reels, /releaseInactiveReelSources\(Number\(idx\)\)/);
  assert.match(reels, /data-index="\$\{index\}"/);
  assert.match(reels, /candidate\.preload=playback\?"auto":"metadata"/);
  assert.match(reels, /entry\.intersectionRatio >= 0\.55/);
  assert.match(reels, /if \(!state\.sessionMuted\)[\s\S]*playWithSoundFallback\(active, state\.activeIndex, \{ explicit: true \}\)/);
  assert.match(reels, /state\.sessionMuted = true;[\s\S]*vid\.muted = true;[\s\S]*syncHeaderMute\(\)/);
  assert.match(reels, /if \(explicit\) return;/);
});
