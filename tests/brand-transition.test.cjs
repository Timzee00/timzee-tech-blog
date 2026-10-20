const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");
const brand=JSON.parse(read("config/brand.json"));
test("proposed Timzee name is not an unauthorized domain cutover",()=>{
 assert.equal(brand.name,"Timzee");
 assert.equal(brand.status,"proposed_pending_clearance");
 assert.equal(brand.allowPublicCutover,false);
 assert.equal(brand.newOrigin,null);
 assert.equal(brand.legacyOrigin,"https://timzee-tech-blog.netlify.app");
});
test("legacy site, login and identifiers stay unchanged during brand preparation",()=>{
 const config=read("assets/js/supabase.js");
 const sitemap=read("netlify/functions/sitemap.js");
 const netlify=read("netlify.toml");
 assert.match(config,/SITE_URL = "https:\/\/timzee-tech-blog\.netlify\.app"/);
 assert.match(sitemap,/timzee-tech-blog\.netlify\.app/);
 assert.match(netlify,/from = "\/sitemap\.xml"/);
 assert.match(read("index.html"),/Timzee Tech Hub/);
});
test("brand plan explicitly protects migration keys and rollback",()=>{
 const plan=read("docs/branding/TIMZEE_MIGRATION_ROLLOUT.md");
 assert.match(plan,/existing OAuth/);
 assert.match(plan,/permanent 301 redirects/);
 assert.match(plan,/rollback|Rollback/);
 assert.match(plan,/SQL table rename/);
 assert.match(plan,/localStorage keys/);
});
