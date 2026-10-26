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
test("reels pin one shared header with an in-page video creator and remembered mute",()=>{
 const html=file("video.html");
 assert.ok(html.includes('class="reel-nav"'));
 assert.ok(html.includes('id="reelHeaderBack"'));
 assert.ok(html.includes('id="reelHeaderMute"'));
 assert.ok(html.includes('class="reel-nav-create" id="reelOpenUpload"'));
 assert.ok(html.includes('id="reelUploadDialog"'));
 assert.ok(html.includes('id="reelUploadForm"'));
 assert.ok(html.includes('uploadDialog.showModal()'));
 assert.ok(html.includes('const result = await uploadVideo('));
 assert.ok(html.includes('!result?.data?.id'));
 assert.ok(html.includes('sessionStorage.setItem("timzee:reels-muted"'));
 assert.equal((html.match(/class="reel-nav" /g)||[]).length,1);
 assert.equal((html.match(/<div class="reel-topbar">/g)||[]).length,0);
 assert.doesNotMatch(html,/reel-create-link/);
});
test("reel replies stay readable while keyboard opens and close restores playback",()=>{
 const html=file("video.html");
 assert.match(html,/drawerForm\.parentNode\.insertBefore\(bar, drawerForm\)/);
 assert.match(html,/\.comment-reply-target\s*\{[\s\S]*?text-overflow: ellipsis/);
 assert.match(html,/\.comment-drawer-form input\s*\{[\s\S]*?min-width: 0/);
 assert.match(html,/\.comment-drawer-form > button\[type="submit"\]/);
 assert.match(html,/state\.commentsOpenFor !== videoId/);
 assert.match(html,/if \(document\.activeElement === drawerInput\) drawerInput\.blur\(\)/);
 assert.match(html,/document\.documentElement\.style\.setProperty\("--reel-screen-height"/);
 assert.match(html,/syncHeaderMute\(\)/);
});

test("video editor resets stale edits when a new file is chosen and seeks before recording",()=>{
 const fs=require("node:fs"),path=require("node:path");
 const html=fs.readFileSync(path.resolve(__dirname,"../videos.html"),"utf8");
 assert.match(html,/state\.trimmedFile=null;\s*state\.editorDirty=false;\s*state\.editRenderInProgress=false;/);
 assert.match(html,/async function renderEditedVideo/);
 assert.match(html,/videoEl\.addEventListener\("seeked",onSeek\)/);
 assert.match(html,/The browser recorded no edited frames/);
});
