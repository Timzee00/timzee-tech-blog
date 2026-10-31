const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const imports=s=>[...s.matchAll(/@import url\("([^"]+)"\);/g)].map(m=>m[1]);
test("homepage keeps essential Blipmood design, accessibility and feed styles",()=>{
 const full=imports(read("assets/css/styles.css"));
 const home=imports(read("assets/css/styles-home.css"));
 for(const essential of [
  "variables.css","base.css","navbar.css","buttons.css","forms.css","avatars.css",
  "content-pages.css","home.css","animations.css","utilities.css","responsive.css",
  "design-system.css","mobile-acceptance-fixes.css","viewport-guard.css",
  "verified-identity.css","reader-journey.css","feature-launches.css","blipmood-brand.css"
 ]){
  assert.ok(home.includes(essential),essential+" must remain on homepage");
 }
 const excluded=["chat.css","chat-context-menu.css","marketplace.css",
  "discussion.css","discussion-enhancements.css","novels.css","stories.css",
  "fyp.css","settings.css","profile.css"];
 for(const page of excluded){
  assert.ok(full.includes(page),"original site styles remain available: "+page);
  assert.ok(!home.includes(page),"homepage should not render "+page);
 }
 assert.ok(home.length<full.length,"homepage must import fewer styles");
 for(const text of ["html[data-reduce-motion","html[data-high-contrast"])
  assert.ok(read("assets/css/styles-home.css").includes(text),"accessibility styles preserved: "+text);
});
test("homepage-only CSS bundle is compiled, versioned and doesn't replace shared CSS on other pages",()=>{
 const build=read("scripts/build-site.mjs"),html=read("index.html");
 assert.match(build,/entryPoints: \[resolve\(root, "assets\/css\/styles\.css"\), resolve\(root, "assets\/css\/styles-home\.css"\), resolve\(root, "assets\/css\/admin\.css"\)\]/);
 assert.match(html,/href="assets\/css\/styles\.css"/);
 assert.match(build,/if \(file === resolve\(output,"index\.html"\)\) \{/);
 assert.match(build,/const fullCss='href="assets\/css\/styles\.css"'/);
 assert.match(build,/contents=contents\.replace\(fullCss,'href="assets\/css\/styles-home\.css"'\)/);
 assert.match(build,/const versioned = contents\.replace/);
});
