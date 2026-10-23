const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const read=p=>fs.readFileSync(path.resolve(__dirname,"..",p),"utf8");
const source=read("assets/js/data.js")
  .replace(/^import\s+.*?;\s*$/gm,"")
  .replace(/^export\s+/gm,"");

const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const record=(n,created_at="2026-10-21T13:45:00.123456")=>
 ({id:id(n),created_at,feed_excerpt:"Small preview",title:"Article "+n,status:"published"});

function harness({rows=[],error=null}={}){
 const calls=[];
 const supabase={from(table){
   const steps={table};
   calls.push(steps);
   const query={
     select(fields){steps.fields=fields;return query;},
     eq(name,value){(steps.eq??=[]).push([name,value]);return query;},
     order(name,value){(steps.order??=[]).push([name,value.ascending]);return query;},
     or(filter){steps.or=filter;return query;},
     limit(limit){steps.limit=limit;return Promise.resolve({data:rows,error});}
   };
   return query;
 }};
 const context={supabase,reportAppError(){},getDisplayName(){},console,Date,Set,Map,Object,Number,String};
 vm.runInNewContext(source+"\nthis.api={fetchFeedPosts,fetchPostCommentPage,POST_PREVIEW_COLUMNS};",context);
 return{...context.api,calls};
}

test("public feed fetches metadata not full article HTML",async()=>{
 const model=harness({rows:[record(1),record(2)]});
 const page=await model.fetchFeedPosts({limit:24});
 assert.equal(page.items.length,2);
 assert.equal(page.hasMore,false);
 assert.equal(page.nextCursor.id,id(2));
 assert.equal(model.calls[0].limit,25);
 assert.deepEqual(Array.from(model.calls[0].order),[["created_at",false],["id",false]]);
 assert.ok(model.calls[0].eq.some(([column,value])=>column==="status"&&value==="published"));
 assert.ok(!model.calls[0].fields.split(",").includes("content"));
 assert.ok(model.calls[0].fields.split(",").includes("feed_excerpt"));
});

test("cursor pagination handles identical timestamps and prevents deep offsets",async()=>{
 const model=harness({rows:Array.from({length:25},(_,i)=>record(i+1))});
 const cursor={created_at:"2026-10-21T13:45:00.123456",id:id(66)};
 const page=await model.fetchFeedPosts({limit:24,cursor});
 assert.equal(page.items.length,24);
 assert.equal(page.hasMore,true);
 assert.equal(page.nextCursor.id,id(24));
 assert.match(model.calls[0].or,/created_at\.lt\./);
 assert.match(model.calls[0].or,/id\.lt\./);
 assert.match(model.calls[0].or,/created_at\.eq\.2026-10-21T13:45:00\.123456/);
 assert.equal(model.calls[0].range,undefined);
});

test("untrusted keyset cursors are rejected before hitting the database",async()=>{
 const model=harness();
 await assert.rejects(
   ()=>model.fetchFeedPosts({cursor:{created_at:"2026-10-21T00:00:00Z),status.eq.draft",id:id(2)}}),
   /Invalid page cursor/
 );
 await assert.rejects(
   ()=>model.fetchFeedPosts({categoryId:"x).or(status.eq.draft)"}),
   /Invalid category/
 );
 assert.equal(model.calls.length,2); // queries were built but never executed
 assert.ok(model.calls.every(row=>!row.limit));
});

test("approved article comments paginate with a stable ascending cursor",async()=>{
 const model=harness({rows:Array.from({length:41},(_,i)=>record(i+1))});
 const result=await model.fetchPostCommentPage({
   postId:id(123),cursor:{id:id(10),created_at:"2026-10-21T13:45:00.123456"},limit:40
 });
 assert.equal(result.items.length,40);
 assert.equal(result.hasMore,true);
 assert.equal(model.calls[0].limit,41);
 assert.equal(model.calls[0].table,"comments");
 assert.ok(model.calls[0].eq.some(([k,v])=>k==="post_id"&&v===id(123)));
 assert.ok(model.calls[0].eq.some(([k,v])=>k==="status"&&v==="approved"));
 assert.deepEqual(Array.from(model.calls[0].order),[["created_at",true],["id",true]]);
 assert.match(model.calls[0].or,/id\.gt\./);
});

test("feed and detail screens never request unlimited related posts or likes",()=>{
 const app=read("assets/js/app.js"),detail=read("assets/js/post.js");
 assert.match(app,/fetchFeedPosts\(\{ limit: POSTS_PAGE_SIZE/);
 assert.match(app,/cursor: state\.postsCursor/);
 assert.match(app,/state\.postsCursor = page\.nextCursor/);
 assert.doesNotMatch(app,/fetchDiscussionMessages\(\)/);
 assert.match(app,/get_popular_discussion_topics/);
 assert.match(detail,/renderPost\(\{categories:\[\]\},post\)/);
 assert.match(detail,/fetchFeedPosts\(\{limit:24,categoryId:/);
 assert.match(detail,/fetchPostCommentPage\(\{postId:post\.id,limit:40\}\)/);
 assert.match(detail,/fetchPostEngagement\(supabase,\[post\.id\]\)/);
 assert.doesNotMatch(detail,/fetchPostLikes\(\{ postId: post\.id \}\)/);
 assert.match(detail,/loadMoreArticleComments/);
});
test("database migration maintains short previews and indexes public access paths",()=>{
 const sql=read("supabase/migrations/20261022141500_feed_previews_keyset_indexes.sql");
 assert.match(sql,/BEFORE INSERT OR UPDATE OF content ON public\.posts/);
 assert.match(sql,/NEW\.feed_excerpt := left\(/);
 assert.match(sql,/posts_public_cursor_idx/);
 assert.match(sql,/posts_public_category_cursor_idx/);
 assert.match(sql,/comments_approved_post_time_idx/);
 assert.match(sql,/videos_public_recent_idx/);
 assert.match(sql,/marketplace_available_recent_idx/);
 assert.match(sql,/IF NOT EXISTS/g);
});
