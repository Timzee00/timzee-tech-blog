const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = p => fs.readFileSync(path.join(root, p), "utf8");
const home = read("index.html");
const css = read("assets/css/blipmood-home.css");
const icon = read("assets/brand/blipmood-mark.svg");

test("Blipmood homepage keeps every data-driven section and settings hook", () => {
  for (const id of [
    "siteName", "siteTagline", "heroTitle", "heroIntro", "authActions",
    "suggestedPeopleSection", "suggestedPeopleRail", "readerJourneySection",
    "latestPosts", "tagFilter", "categoryNav", "trendingList", "leaderboardList",
    "popularTrack", "popularTopicsTrack", "categoryGrid"
  ]) {
    assert.match(home, new RegExp('id="' + id + '"'), id + " should remain intact");
  }
  assert.match(home, /<script type="module" src="assets\/js\/app\.js"><\/script>/);
});
test("Blipmood displays the approved identity with a play button on the i", () => {
  assert.match(home, /class="blipmood-home"/);
  assert.match(home, /class="bm-play-i"/);
  assert.match(home, /assets\/brand\/blipmood-mark\.svg/);
  assert.match(icon, /<svg[\s\S]*<path/);
  assert.match(home, /Your world\.[\s\S]*Your mood\./);
});
test("Navigation continues to point to real existing site routes", () => {
  for (const route of ["fyp.html", "video.html", "discussion.html", "marketplace.html", "novels.html", "stories.html", "ai-chat.html", "login.html?view=signup"]) {
    assert.ok(home.includes('href="' + route + '"'), "missing " + route);
  }
});
test("Homepage styling is scoped, responsive, and respects reduced motion and light mode", () => {
  assert.match(home, /assets\/css\/blipmood-home\.css/);
  assert.match(css, /body\.blipmood-home/);
  assert.match(css, /@media \(max-width: 500px\)/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /data-theme="light"/);
  assert.doesNotMatch(home, /Luna Rivers|Jayden Cruz|Mika Stone|Noah Kade/i, "mockup users are examples, not production data");
});
