const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");
test("review-only article indexes match actual bounded reader queries",()=>{
 const sql=readFileSync(join(__dirname,"../docs/sql/review-only-article-reader-indexes.sql"),"utf8");
 assert.match(sql,/CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_posts_published_category_recent/);
 assert.match(sql,/ON public\.posts \(category_id, created_at DESC, id DESC\)/);
 assert.match(sql,/ON public\.posts \(author_id\)/);
 assert.match(sql,/ON public\.comments \(post_id, created_at DESC, id DESC\)/);
 assert.match(sql,/WHERE status = 'approved'/);
 assert.match(sql,/DO NOT APPLY blindly/);
});
