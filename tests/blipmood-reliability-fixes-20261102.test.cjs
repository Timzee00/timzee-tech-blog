const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const read=name=>fs.readFileSync(path.join(__dirname,"..",name),"utf8");

test("content request validation reads the actual user_email field",()=>{
 const sql=read("supabase/migrations/20261102103500_fix_content_requests_email_trigger.sql");
 assert.match(sql,/IF TG_TABLE_NAME = 'content_requests' THEN\s+clean_email := lower\(trim\(coalesce\(NEW\.user_email, ''\)\)\)/);
 assert.match(sql,/ELSE\s+clean_email := lower\(trim\(coalesce\(NEW\.email, ''\)\)\)/);
 assert.match(sql,/CREATE OR REPLACE FUNCTION public\.validate_public_submission/);
 assert.match(sql,/recent_duplicate/);
});

test("organization and creator workspace websites are HTTPS before saving",()=>{
 const code=read("assets/js/team-workspaces.mjs");
 const start=code.indexOf("function normalizeWorkspaceWebsite(value)");
 const end=code.indexOf("function row(",start);
 assert.ok(start>=0&&end>start);
 const normalize=vm.runInNewContext(code.slice(start,end)+";normalizeWorkspaceWebsite;",{URL,Error});
 assert.equal(normalize("http://blipmood.netlify.app"),"https://blipmood.netlify.app/");
 assert.equal(normalize("blipmood.netlify.app"),"https://blipmood.netlify.app/");
 assert.equal(normalize("https://blipmood.netlify.app/"),"https://blipmood.netlify.app/");
 assert.equal(normalize(""),null);
 assert.throws(()=>normalize("ftp://example.com"));
 assert.throws(()=>normalize("https://bad host.test"));
 assert.throws(()=>normalize("https://user:password@example.com"));
 assert.match(code,/website:normalizeWorkspaceWebsite\(values\.website\)/);
 const html=read("team-workspaces.html");
 assert.equal((html.match(/name="website" type="text" inputmode="url"/g)||[]).length,2);
});

test("reel comments do not fail silently on replying or repeated clicks",()=>{
 const page=read("video.html");
 assert.match(page,/let commentSubmitting = false/);
 assert.match(page,/if \(commentSubmitting\) return/);
 assert.match(page,/if \(result\.error\) throw result\.error/);
 assert.match(page,/showCommentPostStatus\(message, true\)/);
 assert.match(page,/commentPostButton\.disabled = true/);
 assert.match(page,/commentPostButton\.disabled = false/);
 assert.match(page,/drawerForm\.insertAdjacentElement\("beforebegin", commentPostStatus\)/);
 assert.match(page,/if \(state\.commentsOpenFor === videoId\) await openComments\(videoId\)/);
});

test("one-tap public Space entry and return-after-login join flow remain wired",()=>{
 const ui=read("assets/js/live-spaces.mjs");
 assert.match(ui,/await openRoom\(r\.id,\{joinImmediately:live\}\)/);
 assert.match(ui,/login\.html\?next=/);
 assert.match(ui,/encodeURIComponent\("\/spaces\.html\?room="\+r\.id\+"&join=1"\)/);
 assert.match(ui,/openRoom\(selected,\{joinImmediately:q\.get\("join"\)==="1"\}\)/);
 assert.match(ui,/if\(!state\.audioConfigured\)/);
 assert.match(ui,/Joining the Space…/);
 assert.match(ui,/Joined! Tap Play audio below to hear speakers/);
 // Authorization must remain server-controlled, not set by a query flag.
 assert.match(ui,/supabase\.rpc\("spaces_join",\{p_room:state\.roomId\}\)/);
});

test("reply submit retains comment draft when the API fails",()=>{
 const page=read("video.html");
 const start=page.indexOf('drawerForm.addEventListener("submit"');
 const end=page.indexOf("// Attach seller/uploader verification",start);
 const handler=page.slice(start,end);
 assert.ok(start>=0&&end>start);
 const insert=handler.indexOf('const result = await commentOnVideo(');
 const clear=handler.indexOf('drawerInput.value = "";');
 assert.ok(insert>=0&&clear>insert);
 assert.match(handler,/if \(result\.error\) throw result\.error/);
 assert.match(handler,/catch \(error\) \{[\s\S]*?showCommentPostStatus\(message, true\)/);
});
