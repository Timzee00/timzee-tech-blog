const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {resolve}=require("node:path");
const read=path=>readFileSync(resolve(__dirname,"..",path),"utf8");
const html=read("marketplace.html");
const css=read("assets/css/blipmood-marketplace-premium.css");
const api=read("assets/js/videos-marketplace.js");

test("approved marketplace layout is responsive and uses the existing Blipmood identity",()=>{
  assert.match(html,/class="market-premium"/);
  assert.match(html,/blipmood-marketplace-premium\.css/);
  for(const id of ["marketSellQuick","marketWorkspaceClose","marketplaceSearch","marketLocation",
    "marketVerifiedOnly","marketDataSaver","marketSellerSummary","marketSort","prevPageBtn","loadMoreBtn",
    "marketReviewSummary","marketStepNext","marketStepBack"]){
    assert.ok(html.includes('id="'+id+'"'),"Missing marketplace control: "+id);
  }
  assert.match(html,/data-market-view="grid"/);
  assert.match(html,/data-market-view="list"/);
  assert.match(css,/@media\(max-width:600px\)/);
  assert.match(css,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test("search and pagination remain bounded with real city/category filtering",()=>{
  assert.match(html,/limit:state\.limit\+1,offset/);
  assert.match(html,/rows\.slice\(0,state\.limit\)/);
  assert.match(html,/location:state\.location/);
  assert.match(api,/query\.ilike\("location"/);
  assert.match(api,/request\.ilike\("location"/);
  assert.match(html,/state\.offset=Math\.max\(0,state\.offset-state\.limit\)/);
});

test("seller tools are real actions and verification is never invented",()=>{
  assert.match(html,/data-market-workspace="listings"/);
  assert.match(html,/data-market-workspace="inquiries"/);
  assert.match(html,/data-market-workspace="sales"/);
  assert.match(html,/loadMyListings\(\)/);
  assert.match(html,/loadPurchaseConfirmations\(\)/);
  assert.match(html,/loadVerifiedIdentityMap\(supabase,page\.map/);
  assert.match(html,/verifiedLevel\(sellerIdentityMap\.get\(item\.user_id\)\)/);
  assert.match(html,/verifiedName\(safeSellerLabel/);
  assert.doesNotMatch(html,/Verified Seller<\/span>/);
  assert.match(html,/saveUserPreferences\(state\.user\?\.id\|\|null/);
  assert.match(html,/setMarketStep\(marketStep\+1\)/);
});

test("marketplace controls have unique IDs and defined destination paths",()=>{
  const document=html.split('<script type="module" src="assets/js/nav.js"')[0];
  const ids=[...document.matchAll(/(?:^|\s)id="([^"]+)"/gm)].map(m=>m[1]);
  assert.equal(new Set(ids).size,ids.length);
  assert.match(html,/href="listing\.html\?id=/);
  assert.match(html,/href="profile\.html\?id=/);
  assert.equal((css.match(/\{/g)||[]).length,(css.match(/\}/g)||[]).length);
});
