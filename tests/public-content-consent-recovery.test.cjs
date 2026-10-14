const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {pathToFileURL}=require("node:url");
const {resolve}=require("node:path");
const source=path=>fs.readFileSync(path,"utf8");

test("public post cleanup hides editor-only notes but preserves article and takeaways",async()=>{
  const mod=await import(pathToFileURL(resolve("assets/js/public-editorial-content.mjs")).href);
  const content='<p class="curator-editorial-note"><strong>Editorial draft:</strong> AI internal note</p>'+
    '<div hidden data-timzee-takeaways="encoded"></div><h2>Actual article</h2><p>Actual paragraphs stay.</p>'+
    '<p><strong>Editorial roundup draft:</strong> For staff review only.</p>';
  const cleaned=mod.stripEditorialScaffolding(content);
  assert.doesNotMatch(cleaned,/curator-editorial-note|editorial roundup draft/i);
  assert.match(cleaned,/Actual paragraphs stay/);
  assert.match(cleaned,/data-timzee-takeaways/);
});
test("article pages and curator publication remove draft-only instructions",()=>{
  const post=source("assets/js/post.js"),curator=source("assets/js/curator-ui.js");
  const feed=source("assets/js/app.js");
  assert.match(post,/normalizeHtml\(stripEditorialScaffolding\(post.content/);
  assert.match(curator,/placeEditorialFigures\(stripEditorialScaffolding\(body\)/);
  assert.match(feed,/stripEditorialScaffolding\(post.content/);
});
test("cookie consent is optional, persisted, and not assumed after historic unversioned choice",()=>{
  const store=new Map([["timzee_cookie_consent","accepted"]]);
  const cookies=new Map([["timzee_cookie_consent","accepted"]]);
  const storage={getItem:key=>store.get(key)??null,setItem:(key,value)=>store.set(key,value),removeItem:key=>store.delete(key)};
  const doc={readyState:"loading",addEventListener(){},getElementById(){return null},
    get cookie(){return [...cookies].map(([k,v])=>encodeURIComponent(k)+"="+encodeURIComponent(v)).join("; ");},
    set cookie(value){
      const [name,rest]=value.split("="),val=rest.split(";")[0];
      const key=decodeURIComponent(name);
      if(/Max-Age=0/i.test(value))cookies.delete(key);
      else cookies.set(key,decodeURIComponent(val));
    }};
  const win={dispatchEvent(){}};
  const ctx=vm.createContext({document:doc,window:win,localStorage:storage,
    CustomEvent:class{constructor(name,values){this.type=name;this.detail=values.detail}},
    Date,JSON,Number,encodeURIComponent,decodeURIComponent});
  vm.runInContext(source("assets/js/privacy-consent.js")
    .replace(/^export\s+(?=function)/gm,""),ctx);
  assert.equal(vm.runInContext("readConsent()",ctx),"");
  assert.equal(vm.runInContext("hasOptionalCookieConsent('measurement')",ctx),false);
  vm.runInContext("writeConsent({preferences:true,measurement:false})",ctx);
  assert.equal(vm.runInContext("readConsent()",ctx),"custom");
  assert.equal(vm.runInContext("hasOptionalCookieConsent('measurement')",ctx),false);
  assert.equal(vm.runInContext("hasOptionalCookieConsent('preferences')",ctx),true);
  vm.runInContext("writeConsent('declined')",ctx);
  assert.equal(vm.runInContext("hasOptionalCookieConsent('preferences')",ctx),false);
});
test("cookie controls remain discoverable after banner dismissal",()=>{
  const nav=source("assets/js/nav.js");
  const footer=source("assets/js/site-shell.js");
  assert.match(nav,/id="siteMenuCookieSettings"/);
  assert.match(nav,/window.openCookieSettings\(\)/);
  assert.match(footer,/footer-cookie-settings/);
});
test("bad third-party article URLs never become carousel image elements",()=>{
  const s=source("assets/js/popularity-engine.js");
  assert.match(s,/plausibleCoverImage\(post.cover \|\| ""\)/);
  assert.match(s,/popular-media-fallback/);
  const invalid="https://pragmapreneur.com/best-ai-tools-for-business/";
  assert.doesNotMatch(invalid,/\.(?:jpg|png|webp)$/);
});
test("super admin editor links open exactly the requested record",()=>{
  const superPage=source("super/professional-panel.html");
  const admin=source("assets/js/admin.js");
  assert.match(superPage,/admin\/dashboard\.html\?editPost=/);
  assert.match(admin,/new URLSearchParams\(window.location.search\)\.get\("editPost"\)/);
  assert.match(admin,/openPostForEditing\(requestedPost\)/);
  assert.match(admin,/select\("\*"\)\.eq\("id",postId\)\.maybeSingle\(\)/);
  assert.match(admin,/button\[data-tab="compose"\]/);
  assert.match(admin,/let categoryId = categorySelect.value \|\| null/);
});
test("member recovery is in super-admin Users and does not automatically email historical accounts",()=>{
  const page=source("super/professional-panel.html");
  assert.match(page,/Bring members back/);
  assert.match(page,/email-operations\.html\?legacyRecovery=1/);
  assert.match(page,/copyMemberReturnInvite/);
  const ops=source("super/email-operations.html");
  assert.match(ops,/get\("legacyRecovery"\)==="1"/);
});
test("existing article cleanup only removes known internal copy",()=>{
  const sql=source("supabase/migrations/20261015011000_remove_published_editorial_status_notes.sql");
  assert.match(sql,/where status='published'/i);
  assert.match(sql,/replace\(content,/i);
  assert.doesNotMatch(sql,/\bdelete\s+from\s+public\.posts/i);
});
