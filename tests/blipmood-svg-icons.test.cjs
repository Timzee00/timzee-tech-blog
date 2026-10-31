const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root,file),"utf8");

test("consistent accessible SVG icon set", async () => {
  const { icon } = await import("../assets/js/icons.js");
  for (const name of ["home","heart","comment","share","eye","rewind","download","volume-2","volume-x","book-open","bell","bell-off","camera","image","music","file-text","edit","flag","smile","users"]) {
    const markup=icon(name);
    assert.match(markup,/^<svg\b/);
    assert.match(markup,/viewBox="0 0 24 24"/);
    assert.match(markup,/stroke="currentColor"/);
    assert.match(markup,/aria-hidden="true"/);
    assert.match(markup,/<\/svg>$/);
    assert.ok(markup.includes("<path")||markup.includes("<circle")||markup.includes("<rect"));
  }
});

test("homepage social actions use SVG without losing like state", () => {
  const js=read("assets/js/app.js"),css=read("assets/css/home.css");
  for(const name of ["heart","comment","share","eye"]) assert.ok(js.includes('icon("'+name+'")'));
  assert.match(js,/aria-pressed=/);
  assert.match(js,/btn\.setAttribute\("aria-pressed", String\(liked\)\)/);
  assert.match(css,/data-action="like".*?fill: currentColor/);
  assert.doesNotMatch(js,/&#128172;|&#128065;|&#8663;|&#9825;/);
});

test("reels, videos and novels use the shared SVG renderer", () => {
  const reel=read("video.html"), videos=read("videos.html"), novels=read("novels.html");
  for(const name of ["heart","comment","rewind","share","download","eye"]) assert.ok(reel.includes('icon("'+name+'")'));
  assert.match(reel,/icon\(state\.sessionMuted \? "volume-x" : "volume-2"\)/);
  assert.match(reel,/heart\.innerHTML = icon\("heart"\)/);
  for(const name of ["heart","eye"]) assert.ok(videos.includes('icon("'+name+'")'));
  for(const name of ["book-open","heart","eye"]) assert.ok(novels.includes('icon("'+name+'")'));
});

test("chat and community icon slots hydrate without removing reaction emoji choices", () => {
  for(const file of ["novel.html","chat.html","discussion.html"]) assert.match(read(file),/data-bm-icon=/);
  assert.match(read("assets/js/nav.js"),/querySelectorAll\("\[data-bm-icon\]"\)/);
  assert.match(read("assets/js/chat-v2.js"),/querySelectorAll\("\[data-bm-icon\]"\)/);
  assert.match(read("assets/js/chat-context-menu.js"),/data-emoji=/);
});
