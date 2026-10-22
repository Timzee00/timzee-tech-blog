const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const src=fs.readFileSync("assets/js/data.js","utf8");
const migration=fs.readFileSync("supabase/migrations/20261022161000_feed_lookup_scale_indexes.sql","utf8");
const section=(start,end)=>src.slice(src.indexOf(start),src.indexOf(end,src.indexOf(start)+start.length));
test("public feed uses bounded projection without full article bodies",()=>{
 const body=section("export async function fetchPosts(","export async function fetchPostMedia(");
 assert.match(body,/isPublicList/);
 assert.match(body,/feed_excerpt/);
 assert.match(body,/if \(isPublicList \|\|/);
 assert.match(body,/Math\.min\(50/);
 assert.doesNotMatch(body,/select\("content"\)/);
});
test("search results are server-limited and omit long article content",()=>{
 const body=section("export async function searchPosts(","export async function fetchTopProfiles(");
 assert.match(body,/\.limit\(30\)/);
 assert.match(body,/\.select\("id,title,slug,/);
 assert.doesNotMatch(body,/\.select\("\*"\)/);
});
test("database has indexes matching legacy status OR and exact slug search",()=>{
 assert.match(migration,/posts_legacy_public_feed_cursor_idx/);
 assert.match(migration,/WHERE status IS NULL OR status='published' OR status='scheduled'/);
 assert.match(migration,/posts_slug_lookup_idx/);
 assert.match(migration,/posts_tags_filter_gin_idx/);
 assert.match(migration,/posts_author_public_recent_idx/);
 assert.doesNotMatch(migration,/DROP TABLE|TRUNCATE|DELETE FROM/);
});
