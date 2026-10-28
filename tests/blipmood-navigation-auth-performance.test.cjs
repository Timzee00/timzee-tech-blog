const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const read=file=>fs.readFileSync(file,"utf8");
test("one custom Blipmood PNG per viewport, never a duplicate text wordmark",()=>{
 const menu=read("assets/js/blipmood-unified-menu.mjs");
 assert.match(menu,/bm-rail-brand.*data-bm-logo=/);
 assert.doesNotMatch(menu,/>✦ <span>Blipmood<\/span>/);
 assert.match(menu,/\.bm-has-unified-rail \.site-header \.brand\{display:none!important\}/);
 assert.match(menu,/@media\(max-width:1189px\)/);
 assert.match(read("assets/js/site-shell.js"),/ensureBlipmoodHeader/);
});
test("menu buttons have labels, one scroll surface and coordinated routes",()=>{
 const nav=read("assets/js/nav.js"),css=read("assets/css/navbar.css");
 assert.match(nav,/nav-action-label/);
 assert.match(nav,/Status updates/);assert.match(nav,/Messages/);
 assert.match(css,/\.site-menu \.bm-drawer-navigation\{display:block;overflow:visible!important;max-height:none!important/);
 assert.match(css,/\.site-menu \.header-actions \.icon-btn \.nav-action-label\{display:inline/);
 assert.match(read("assets/js/blipmood-unified-menu.mjs"),/Help & Support/);
});
test("authenticated Join community is not redirected back to signup",()=>{
 const app=read("assets/js/app.js"),login=read("assets/js/user-auth.js");
 assert.match(app,/installImmediateCommunityJoin\(\)/);
 assert.match(app,/getCurrentUser\(\)/);
 assert.match(app,/identity\?\.id\?"\/discussion\.html"/);
 assert.match(app,/syncCommunityJoinLinks\(\)/);
 assert.match(login,/queryParams\.get\("view"\)==="signup"/);
 assert.match(login,/nextAfterMemberSetup\(user,nextUrl\)/);
});
test("profile CSS wins the cascade and layout fits narrow phones",()=>{
 const styles=read("assets/css/styles.css"),profile=read("assets/css/profile.css");
 assert.ok(styles.indexOf('@import url("profile.css")')>styles.indexOf('@import url("blipmood-brand.css")'));
 assert.match(profile,/\.profile-page \.profile-hero/);
 assert.match(profile,/@media\(max-width:390px\)/);
 assert.match(profile,/overflow-x:clip/);
});
test("welcome art and optional analytics are deferred off initial paint",()=>{
 const shell=read("assets/js/site-shell.js"),campaign=read("assets/js/blipmood-welcome.mjs");
 assert.doesNotMatch(shell,/^import "\.\/blipmood-welcome\.mjs";/m);
 assert.doesNotMatch(shell,/^import "\.\/visitor-analytics\.js";/m);
 assert.match(shell,/window\.setTimeout/);
 assert.match(shell,/import\("\.\/blipmood-welcome\.mjs"\)/);
 assert.match(campaign,/authActions a\[href\*=/);
 const analytics=read("assets/js/visitor-analytics.js");
 assert.match(analytics,/response\.status===503/);
});
test("curator writes are idempotent and do not generate 23505 duplicate errors",()=>{
 const scout=read("netlify/functions/scout-news.js");
 assert.match(scout,/\.upsert\(payload, \{onConflict:"url",ignoreDuplicates:true\}\)/);
 assert.match(scout,/\.maybeSingle\(\)/);
 assert.match(scout,/duplicates\+\+; continue/);
});
