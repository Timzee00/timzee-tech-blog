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

test("mobile chat search and filters preserve tab counts",()=>{
 const fs=require("node:fs"),path=require("node:path");
 const get=n=>fs.readFileSync(path.resolve(__dirname,"..",n),"utf8");
 for(const id of ["requestsBadge","groupsBadge","blockedBadge"])assert.ok(get("chat.html").includes('id="'+id+'"'));
 assert.ok(get("assets/css/chat-fixes.css").includes("grid-template-columns:repeat(4,minmax(0,1fr))"));
 assert.ok(get("assets/js/chat-v2.js").includes('badge=$("groupsBadge")'));
 assert.ok(get("assets/js/chat-v2.js").includes('badge=$("blockedBadge")'));
});
test("reels provide a creator shortcut",()=>{
 const fs=require("node:fs"),path=require("node:path");
 const html=fs.readFileSync(path.resolve(__dirname,"../video.html"),"utf8");
 assert.ok(html.includes('class="reel-create-link"'));
 assert.ok(html.includes('href="videos.html#uploadSection"'));
});
