const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {resolve}=require("node:path");
const read=path=>readFileSync(resolve(__dirname,"..",path),"utf8");

test("marketplace uses one bounded page and reliable filters",()=>{
  const html=read("marketplace.html");
  const data=read("assets/js/videos-marketplace.js");
  assert.match(html,/id="marketSort"/);
  assert.match(html,/id="prevPageBtn"/);
  assert.match(html,/id="marketPageIndicator"/);
  assert.match(html,/limit:state\.limit\+1,offset/);
  assert.match(html,/rows\.slice\(0,state\.limit\)/);
  assert.match(html,/state\.listings=page/);
  assert.doesNotMatch(html,/state\.listings\s*=\s*offset\s*===\s*0\s*\?\s*rows/);
  assert.match(html,/state\.offset=Math\.max\(0,state\.offset-state\.limit\)/);
  assert.match(html,/state\.category = button\.dataset\.category/);
  assert.match(html,/state\.sort=event\.target\.value/);
  assert.match(data,/sort === "popular"/);
  assert.match(data,/\.order\("id",\{ascending:false\}\)/);
  assert.match(html,/fetchpriority="low"/);
});

test("profile floating actions stay visible and verification still uses trusted identity",()=>{
  const profile=read("assets/js/profile.js"),css=read("assets/css/blipmood-profile-redesign.css");
  assert.match(profile,/document\.body\.appendChild\(menu\)/);
  assert.match(profile,/window\.innerWidth-width-12/);
  assert.match(profile,/window\.innerHeight-height-12/);
  assert.match(profile,/event\.key==="Escape"/);
  assert.match(profile,/disposeProfileActionMenu\(\)/);
  assert.match(profile,/name\.innerHTML = verifiedName\(displayName,state\.profile\)/);
  assert.match(profile,/profile-long-name/);
  assert.match(css,/profile-action-floating-menu\[hidden\]/);
  assert.match(css,/box-decoration-break:clone/);
});

test("reels use Blipmood copy and compact recognition controls above the name",()=>{
  const html=read("video.html");
  assert.doesNotMatch(html,/Timzee community|Timzee Reels/i);
  const flags=html.indexOf('<div class="reel-creator-flags"');
  const author=html.indexOf('<div class="reel-uploader">',flags);
  assert.ok(flags>0 && author>flags);
  assert.match(html,/\$\{staff\}/);
  assert.match(html,/data-edit-reel/);
  assert.match(html,/verifiedName\("@"\+uploaderName,profile,\{compact:true\}\)/);
  assert.match(html,/reel-creator-flags \.reel-edit-caption/);
});

test("site-wide saver is a real stored preference with lean media behaviour",()=>{
  const settings=read("settings.html");
  const prefs=read("assets/js/user-preferences.js");
  const experience=read("assets/js/experience-preferences.js");
  const theme=read("assets/js/theme-init.js");
  const reels=read("video.html");
  assert.match(settings,/data-path="performance\.dataSaver"/);
  assert.match(prefs,/performance:\s*\{\s*dataSaver: false/);
  assert.match(prefs,/blipmood:data-saver/);
  assert.match(theme,/syncEarlyDataSaver\(\)/);
  assert.match(experience,/function applySiteDataSaver\(preferences\)/);
  assert.match(experience,/image\.loading="lazy"/);
  assert.match(experience,/video\.preload=video\.classList\.contains\("reel-video"\)\?"metadata":"none"/);
  assert.match(reels,/state\.preferences\.performance\?\.dataSaver/);
});
