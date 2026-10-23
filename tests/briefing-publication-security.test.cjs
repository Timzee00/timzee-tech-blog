const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const root=path.resolve(__dirname,"..");
const read=p=>fs.readFileSync(path.join(root,p),"utf8");

test("public elevated briefing selects only explicitly published content",()=>{
  const sql=read("supabase/migrations/20261023111914_restrict_my_tech_brief_to_explicit_published_articles.sql");
  assert.match(sql,/CREATE OR REPLACE FUNCTION public\.my_tech_brief\(/);
  assert.match(sql,/SECURITY DEFINER/);
  assert.match(sql,/WHERE p\.status='published'/);
  assert.match(sql,/p\.publish_at IS NULL OR p\.publish_at<=timezone\('utc',now\(\)\)/);
  assert.doesNotMatch(sql,/coalesce\(lower\(p\.status\),'published'\)/i);
  assert.match(sql,/LIMIT least\(greatest\(coalesce\(p_limit,5\),1\),5\)/);
});

test("public article preview and briefing code have bounded publication-only visibility",()=>{
  const data=read("assets/js/data.js");
  const sql=read("supabase/migrations/20261023111914_restrict_my_tech_brief_to_explicit_published_articles.sql");
  assert.match(data,/fetchFeedPosts/);
  assert.match(data,/\.eq\("status","published"\)/);
  assert.match(sql,/WHERE p\.status='published'/);
});
