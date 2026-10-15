const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");
const root=join(__dirname,"..");
const file=(path)=>readFileSync(join(root,path),"utf8");
test("full-screen reel module parses and only attaches active video sources",()=>{
  const html=file("video.html");
  const script=[...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)]
    .find(match=>match[2].includes("wireItems"))?.[2];
  assert.ok(script);
  const withoutImports=script.replace(/^\s*import\s*(?:[\s\S]*?)\s*from\s*["'][^"']+["'];/gm,"");
  assert.doesNotThrow(()=>new Function(withoutImports));
  const videoTag=html.match(/<video class="reel-video"[^>]*>/)?.[0];
  assert.ok(videoTag);
  assert.match(videoTag,/data-video-src=/);
  assert.doesNotMatch(videoTag,/\ssrc=/);
  assert.match(html,/data-reel-tap-wired/);
  assert.match(html,/data-reel-video-wired/);
  assert.match(html,/preferences\.videos\.dataSaver/);
});
test("viewer remembers mute choice while navigating reels",()=>{
  const html=file("video.html");
  assert.match(html,/sessionStorage\.setItem\("timzee:reels-muted"/);
  assert.match(html,/sessionStorage\.getItem\("timzee:reels-muted"/);
});
test("editorial preview respects phone viewport and scrolls inside a dialog",()=>{
  const code=file("assets/js/curator-ui.js");
  assert.match(code,/height:min\(92dvh,900px\)/);
  assert.match(code,/overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain/);
  assert.match(code,/media\.style\.objectFit="contain"/);
});
test("mentions preserve cursor, reject email tokens, and allow empty typed @",()=>{
  const source=file("assets/js/mentions.js");
  const moduleSource=source.replace(/^\s*import\s*(?:[\s\S]*?)\s*from\s*["'][^"']+["'];/gm,"")
    .replace(/^\s*export\s+default\s+/gm,"").replace(/^\s*export\s+/gm,"");
  assert.doesNotThrow(()=>new Function(moduleSource));
  assert.match(source,/visualViewport/);
  assert.match(source,/pointerdown/);
  assert.match(source,/lastAtIndex/);
  const token=/(^|[^\w@])@([a-z0-9_]*)$/i;
  assert.equal("hello @member".match(token)?.[2],"member");
  assert.equal("hello@domain.com".match(token),null);
});

test("public video uploads cache immutable objects and reel playback resumes",()=>{
 const upload=file("assets/js/videos-marketplace.js");
 const reels=file("video.html");
 assert.match(upload,/cacheControl:\s*"604800"/);
 assert.match(upload,/upsert:\s*false/);
 assert.match(upload,/\${timestamp}-\${safeVideoName}/);
 assert.match(reels,/createReelProgressStore/);
 assert.match(reels,/loadedmetadata/);
 assert.match(reels,/progressStore\?\.set/);
});
test("only autoplay policy failures may change global mute state",()=>{
 const reels=file("video.html");
 assert.ok(reels.includes('error?.name !== "NotAllowedError" || explicit'));
});
test("curator previews and reader recover from external image failures",()=>{
 const ui=file("assets/js/curator-ui.js");
 const reader=file("assets/js/post.js");
 assert.match(ui,/parseEditorialImageRows/);
 assert.match(ui,/checkCuratorAiBtn/);
 assert.match(ui,/image\.replaceWith\(placeholder\)/);
 assert.match(reader,/image\.replaceWith\(link\)/);
});
