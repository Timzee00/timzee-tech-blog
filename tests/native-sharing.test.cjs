const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=file=>fs.readFileSync(path.resolve(__dirname,"..",file),"utf8");

test("Android installed PWA is a bounded, local-only share target",()=>{
 const app=JSON.parse(read("app.webmanifest"));
 assert.equal(app.share_target.action,"/share-target");
 assert.equal(app.share_target.method,"POST");
 assert.equal(app.share_target.enctype,"multipart/form-data");
 assert.deepEqual(
  [app.share_target.params.title,app.share_target.params.text,app.share_target.params.url],
  ["title","text","url"]
 );
 const supported=app.share_target.params.files[0];
 assert.equal(supported.name,"media");
 for(const mime of ["image/jpeg","image/png","video/mp4","video/webm"])
  assert.ok(supported.accept.includes(mime),"missing "+mime);
 const worker=read("sw.js");
 assert.match(worker,/request\.method==="POST"&&incomingUrl\.origin===self\.location\.origin/);
 assert.match(worker,/incomingUrl\.pathname==="\/share-target"/);
 assert.match(worker,/request\.formData\(\)/);
 assert.match(worker,/indexedDB\.open\(SHARE_DB,1\)/);
 assert.match(worker,/Response\.redirect\(new URL\("\/share-inbox\.html\?id="/);
 assert.match(worker,/bytes>45\*1024\*1024/);
 assert.match(worker,/rawFiles\.length>6/);
 assert.doesNotMatch(worker,/cache\.put\(.*share-target/);
});

test("Incoming share is a review flow, not an anonymous upload endpoint",()=>{
 const page=read("share-inbox.html"),logic=read("assets/js/share-inbox.mjs");
 for(const id of ["shareNotice","sharePreview","shareDestinations","shareRecipients",
  "shareSend","shareDiscard","shareStatusOptions","shareCommunityOptions","shareLoginLink"])
  assert.ok(page.includes('id="'+id+'"'),id);
 assert.match(page,/noindex,nofollow,noarchive/);
 assert.match(page,/role="status" aria-live="polite"/);
 assert.match(logic,/getCurrentUser\(\)/);
 assert.match(logic,/can_send_direct_message/);
 assert.match(logic,/supabase\.from\("chat_members"\)/);
 assert.match(logic,/supabase\.from\("direct_messages"\)\.insert\(message\)/);
 assert.match(logic,/uploadMedia\(file,"direct-messages"\)/);
 assert.match(logic,/getChatMediaPath\(mediaUrl\)/);
 assert.match(logic,/createStory\(\{/);
 assert.match(logic,/savePendingShare\(pending\)/);
 assert.match(logic,/uncertainTo/);
 assert.match(logic,/location\.assign\("\/discussion\.html\?incoming_share="/);
 assert.match(logic,/deletePendingShare\(pending\.id\)/);
 assert.match(logic,/Nothing to send/);
 assert.match(page,/id="shareManualForm"/);
 assert.match(page,/id="shareManualMedia"/);
 assert.match(page,/id="shareManualRecovery"/);
 assert.match(logic,/shareManualRecovery/);
 assert.match(logic,/function showManualImport\(\)/);
 assert.match(logic,/recipientSelection\.size>=limit/);
 assert.match(logic,/safeExternalUrl\(raw\)/);
});

test("Community share reuses normal editor and rules, never auto publishes",()=>{
 const forum=read("assets/js/community-forum.mjs");
 assert.match(forum,/async function openIncomingShareDraft/);
 assert.match(forum,/showDialog\("forumThreadDialog"\)/);
 assert.match(forum,/forumThreadRulesAcknowledged"\)\.checked=false/);
 assert.match(forum,/incomingShareDraftId=id/);
 assert.match(forum,/await openIncomingShareDraft\(\)/);
 assert.match(forum,/await deletePendingShare\(completed\)/);
 assert.match(forum,/Choose where to publish/);
});

test("Status share links are clickable without copying Spotify audio",()=>{
 const view=read("stories.html");
 const css=read("assets/css/stories.css");
 assert.match(view,/safeExternalUrl\(match\[0\]/);
 assert.match(view,/link\.rel="noopener noreferrer"/);
 assert.match(view,/link\.referrerPolicy="no-referrer"/);
 assert.match(view,/Open on Spotify/);
 assert.match(css,/story-source-link:focus-visible/);
 assert.doesNotMatch(read("assets/js/share-inbox.mjs"),/preview_url/);
 assert.match(read("_headers"),/connect-src 'self' https:\/\/open\.spotify\.com/);
});

test("Shared links refuse insecure schemes and userinfo",async()=>{
 const {safeExternalUrl,sharedUrl,isSpotifyUrl}=await import("../assets/js/share-target-store.mjs");
 assert.equal(safeExternalUrl("javascript:alert(1)"),"");
 assert.equal(safeExternalUrl("http://example.com"),"");
 assert.equal(safeExternalUrl("https://person:secret@example.com"),"");
 assert.equal(safeExternalUrl("https://"),"");
 assert.equal(sharedUrl({url:"https://example.com/path",text:"hey"}),"https://example.com/path");
 assert.equal(sharedUrl({url:"javascript:evil",text:"Listen https://open.spotify.com/track/123"}),
  "https://open.spotify.com/track/123");
 assert.equal(isSpotifyUrl("https://open.spotify.com/track/123"),true);
 assert.equal(isSpotifyUrl("https://spotify.link/123"),true);
 assert.equal(isSpotifyUrl("https://open.spotify.com.attacker.tld/track/123"),false);
 assert.equal(isSpotifyUrl("https://evil.com/?next=open.spotify.com"),false);
 assert.equal(sharedUrl({title:"Song: https://open.spotify.com/track/123",text:""}),"https://open.spotify.com/track/123");
});

test("Spotify cover metadata is allowlisted and non-executable",async()=>{
 const {spotifyPreview}=await import("../assets/js/share-target-store.mjs");
 const before=global.fetch;
 global.fetch=async()=>({ok:true,json:async()=>({
  title:"A safe track",thumbnail_url:"https://evil.example/tracker.png",html:"<script>alert(1)</script>"
 })});
 try{
  const preview=await spotifyPreview("https://open.spotify.com/track/123");
  assert.deepEqual(preview,{title:"A safe track",provider:"Spotify",image:""});
 }finally{global.fetch=before;}
});


test("Service worker receives a real share and redirects to its on-device inbox",async()=>{
 const vm=require("node:vm");
 const listeners={};
 let stored=null;
 const sandbox={
  self:{location:{origin:"https://blipmood.netlify.app"},addEventListener:(name,fn)=>{listeners[name]=fn;}},
  URL,Response,Date,console,crypto:{randomUUID:()=>"11111111-1111-4111-8111-111111111111"}
 };
 vm.runInNewContext(read("sw.js")+
  "\nstoreIncomingShare=async row=>{globalThis.__stored=row;};globalThis.__receive=receiveNativeShare;",
  sandbox,{timeout:3000});
 const payload={
  getAll:(field)=>field==="media"?[]:[],
  get:(field)=>({title:"Praise The Lord",text:"Listen to this song",url:"https://open.spotify.com/track/123"})[field]||""
 };
 const response=await sandbox.__receive({formData:async()=>payload});
 assert.equal(response.status,303);
 assert.equal(response.headers.get("location"),
  "https://blipmood.netlify.app/share-inbox.html?id=11111111-1111-4111-8111-111111111111");
 assert.equal(sandbox.__stored.title,"Praise The Lord");
 assert.equal(sandbox.__stored.files.length,0);
 assert.equal(sandbox.__stored.sentTo["a"],undefined);
 const missing=await sandbox.__receive({formData:async()=>({getAll:()=>[],get:()=>""})});
 assert.equal(missing.status,303);
 assert.equal(missing.headers.get("location"),
  "https://blipmood.netlify.app/share-inbox.html?manual=1");
 const filenameOnly=await sandbox.__receive({formData:async()=>({
  getAll:()=>[],get:field=>field==="title"?"IMG_1007.jpg":""
 })});
 assert.equal(filenameOnly.status,303);
 assert.equal(filenameOnly.headers.get("location"),
  "https://blipmood.netlify.app/share-inbox.html?manual=1");
 const tooLarge={
  getAll:(field)=>field==="media"?[{size:45*1024*1024+1,type:"image/jpeg",name:"photo.jpg"}]:[],
  get:()=> ""
 };
 const denied=await sandbox.__receive({formData:async()=>tooLarge});
 assert.equal(denied.status,507);
 assert.equal(sandbox.__stored.title,"Praise The Lord","rejected share must not replace the saved item");
});
