const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs");
const read=file=>fs.readFileSync(file,"utf8");
const includes=(file,value)=>assert.ok(read(file).includes(value),file+": "+value);
test("welcome setup has 3 accessible stages and private data storage",()=>{
 const html=read("welcome.html"),logic=read("assets/js/member-onboarding.mjs"),
  auth=read("assets/js/user-auth.js"),schema=read("supabase/migrations/20261028151500_private_member_onboarding.sql");
 assert.equal((html.match(/data-stage="[123]"/g)||[]).length,3);
 for(const id of ["setupName","setupUsername","setupAge","setupGender","setupFinish","setupBack"])assert.ok(html.includes('id="'+id+'"'));
 assert.match(html,/min="13"/);assert.match(html,/aria-current="step"/);assert.match(html,/prefers-reduced-motion/);
 assert.match(logic,/from\("member_onboarding"\)\.upsert/);
 assert.match(logic,/show_email:false/);assert.match(logic,/avatar-female\.svg/);
 assert.match(auth,/nextAfterMemberSetup\(user,nextUrl\)/);
 assert.match(schema,/ENABLE ROW LEVEL SECURITY/);
 assert.match(schema,/auth\.uid\(\)\)=user_id/);
 assert.doesNotMatch(schema,/CREATE\s+POLICY[\s\S]*\bUSING\(true\)/i);
});
test("annual leaderboard archives champions without resetting lifetime points",()=>{
 const sql=read("supabase/migrations/20261028151000_annual_leaderboard_archive.sql"),
 app=read("assets/js/app.js"),data=read("assets/js/data.js"),home=read("index.html");
 assert.match(sql,/leaderboard_year_scores/);assert.match(sql,/leaderboard_year_winners/);
 assert.match(sql,/profile_annual_points/);assert.match(sql,/30 0 1 1 \*/);
 assert.doesNotMatch(sql,/UPDATE public\.profiles SET points\s*=\s*0/i);
 assert.match(data,/fetchAnnualLeaderboard/);assert.match(data,/fetchAnnualChampions/);
 assert.match(app,/annual_score/);assert.match(home,/id="annualChampions"/);
});
test("neon popup is dismissible and coordinated navigation stays viewport-aware",()=>{
 const shell=read("assets/js/site-shell.js"),menu=read("assets/js/blipmood-unified-menu.mjs"),
 hero=read("assets/js/blipmood-welcome.mjs");
 assert.match(shell,/blipmood-unified-menu\.mjs/);assert.match(shell,/blipmood-welcome\.mjs/);
 assert.match(menu,/Discover/);assert.match(menu,/Connect/);assert.match(menu,/Your space/);
 assert.match(menu,/max-height:calc\(100dvh - 200px\)/);
 assert.match(hero,/aria-modal/);assert.match(hero,/bm-welcome-close/);assert.match(hero,/prefers-reduced-motion/);
 assert.match(hero,/calc\(100dvh - 18px\)/);
});
test("admin AI drafts are authenticated and never autopublished",()=>{
 const admin=read("admin/dashboard.html"),ai=read("assets/js/admin-ai-studio.mjs"),popup=read("assets/js/notification-popup.js");
 for(const id of ["aiGenerateDraft","aiInsertDraft","aiDraftTarget","postVisualOnly","announcementVisual"])assert.ok(admin.includes('id="'+id+'"'));
 assert.match(ai,/getSession/);assert.match(ai,/\.netlify\/functions\/llm-proxy/);
 assert.match(ai,/button\.disabled=true/);assert.match(ai,/Use this draft/);
 assert.doesNotMatch(ai,/from\("posts"\)\.insert/);
 assert.match(popup,/banner_image_url/);
 assert.match(popup,/site-announcement-banner--visual/);
 assert.match(read("assets/js/admin.js"),/uploadMedia\(visualFile,"announcement-banners"\)/);
});
test("seller studio supports editing, visibility restoration, deletion and ratings",()=>{
 const market=read("marketplace.html"),listing=read("listing.html");
 for(const id of ["myMarketListings","marketPurchaseRequests","marketPurchaseQueue","marketImageLaunch"].slice(0,3))assert.ok(market.includes('id="'+id+'"'));
 for(const word of ['data-own-act="edit"','data-own-act="visibility"','data-own-act="delete"'])assert.ok(market.includes(word));
 assert.match(market,/updateMarketplaceItem\(item\.id,state\.user\.id,\{is_available:!item\.is_available\}\)/);
 assert.match(market,/deleteMarketplaceItem\(item\.id,state\.user\.id\)/);
 assert.match(market,/market-card-photo-link/);
 assert.match(listing,/id="marketImageViewer"/);
 assert.match(listing,/id="marketBuyerReview"/);
 assert.match(listing,/marketplace_item_reviews/);
 assert.match(market,/marketplace_transactions/);
 const policy=read("supabase/migrations/20261028153000_confirmed_marketplace_reviews.sql");
 assert.match(policy,/status='completed'/);assert.match(policy,/marketplace_transaction_guard/);
 assert.match(policy,/Verified buyer writes product rating/);
});
test("profile uses mature responsive layout without exposing onboarding demographics",()=>{
 const profile=read("profile.html"),css=read("assets/css/profile.css"),
 logic=read("assets/js/profile.js");
 assert.match(profile,/id="profileHandle"/);
 assert.match(logic,/profileHandle/);
 assert.match(css,/grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
 assert.match(css,/@media\(max-width:390px\)/);
 assert.match(css,/overflow-x:clip/);
 assert.doesNotMatch(profile,/\b(age_years|member_onboarding|setupGender)\b/);
});
