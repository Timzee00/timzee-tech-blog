const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");
const read=file=>fs.readFileSync(path.resolve(__dirname,"..",file),"utf8");
const id=n=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");

function dataHarness(rows=[]){
  const calls=[];
  const supabase={from(table){
    const call={table,orders:[]};calls.push(call);
    const query={
      select(columns,options){call.columns=columns;call.selectOptions=options;return query;},
      order(column,options){call.orders.push([column,options.ascending]);return query;},
      or(value){call.cursorFilter=value;return query;},
      is(column,value){(call.is??=[]).push([column,value]);return query;},
      lt(column,value){(call.lt??=[]).push([column,value]);return query;},
      gt(column,value){(call.gt??=[]).push([column,value]);return query;},
      eq(column,value){(call.eq??=[]).push([column,value]);return query;},
      neq(column,value){(call.neq??=[]).push([column,value]);return query;},
      limit(value){call.limit=value;return Promise.resolve({data:rows,error:null});}
    };
    return query;
  }};
  const source=read("assets/js/data.js");
  const start=source.indexOf("function requirePageCursor");
  const end=source.indexOf("export async function fetchFeedPosts",start);
  assert.ok(start>=0&&end>start,"admin page helpers must share the cursor validator");
  const isolated=source.slice(start,end).replace(/\bexport\s+/g,"");
  const context={supabase,Math,Number,String,Date,Array,Object,RegExp,Error};
  vm.runInNewContext(isolated+";this.api={fetchAdminPostsPage,fetchCommentModerationPage,fetchAdminQueuePage};",context);
  return {...context.api,calls};
}
const sampleRows=Array.from({length:41},(_,i)=>({
  id:id(i+1),
  created_at:"2026-11-01T12:00:"+String(i%60).padStart(2,"0")+"Z",
  title:"Row "+i
}));

test("admin post table uses a compact 40-row cursor page",async()=>{
  const model=dataHarness(sampleRows);
  const page=await model.fetchAdminPostsPage({limit:40});
  assert.equal(page.items.length,40);
  assert.equal(page.hasMore,true);
  assert.equal(page.nextCursor.id,id(40));
  assert.equal(model.calls[0].table,"posts");
  assert.equal(model.calls[0].limit,41);
  assert.ok(!model.calls[0].columns.split(",").includes("content"));
  assert.deepEqual(model.calls[0].orders,[["created_at",false],["id",false]]);
});

test("admin post next page validates cursor and does not use offset",async()=>{
  const model=dataHarness(sampleRows);
  const page=await model.fetchAdminPostsPage({
    cursor:{created_at:"2026-11-01T12:00:20Z",id:id(22)},
    limit:40
  });
  assert.equal(page.items.length,40);
  assert.match(model.calls[0].cursorFilter,/created_at\.lt\./);
  assert.match(model.calls[0].cursorFilter,/id\.lt\./);
  assert.equal(model.calls[0].limit,41);
  await assert.rejects(()=>model.fetchAdminPostsPage({
    cursor:{created_at:"not-a-date",id:"invalid"}
  }),/Invalid page cursor/);
});

test("comment moderation uses one bounded query with related post title",async()=>{
  const model=dataHarness(sampleRows);
  const page=await model.fetchCommentModerationPage({limit:40});
  assert.equal(page.items.length,40);
  assert.equal(model.calls[0].table,"comments");
  assert.equal(model.calls[0].limit,41);
  assert.match(model.calls[0].columns,/posts\(title\)/);
  assert.deepEqual(model.calls[0].orders,[["created_at",true],["id",true]]);
});

test("request queue names are allow-listed and fields are projected",async()=>{
  const model=dataHarness(sampleRows);
  const page=await model.fetchAdminQueuePage("contact",{limit:30});
  assert.equal(page.items.length,30);
  assert.equal(model.calls[0].table,"contact_requests");
  assert.equal(model.calls[0].limit,31);
  assert.ok(model.calls[0].columns.split(",").includes("subject"));
  await assert.rejects(()=>model.fetchAdminQueuePage("untrusted"),/Unsupported admin queue/);
});

test("admin first load pages posts/comments and defers hidden queues",()=>{
  const admin=read("assets/js/admin.js");
  const refresh=admin.slice(admin.indexOf("async function refreshData()"),admin.indexOf("function syncAdminPageButtons()"));
  assert.match(refresh,/fetchAdminPostsPage/);
  assert.match(refresh,/fetchCommentModerationPage/);
  for(const oldFetch of ["fetchPosts","fetchComments","fetchContactRequests","fetchSupportRequests",
    "fetchNewsletterSignups","fetchAdApplications","fetchAdminRequests","fetchContentRequests"])
    assert.doesNotMatch(refresh,new RegExp(oldFetch+"\\("));
  assert.match(admin,/button\.dataset\.tab === "requests"\) void ensureRequestsLoaded\(\)/);
  assert.match(admin,/button\.dataset\.tab === "announcements"\) void ensureAnnouncementsLoaded\(\)/);
  assert.match(admin,/function loadMoreRequestQueue\(/);
  assert.match(admin,/function loadMoreAdminPage\(/);
});

test("full article bodies load only when staff opens a post",()=>{
  const admin=read("assets/js/admin.js");
  const open=admin.slice(admin.indexOf("async function openPostForEditing"),admin.indexOf("function renderPostsTable"));
  assert.match(open,/from\("posts"\)\.select\("\*"\)\.eq\("id",postId\)/);
  assert.match(read("assets/js/data.js"),/fetchAdminPostsPage[\s\S]*?select\("id,title,category_id,status,updated_at,created_at,pinned"\)/);
});

test("curator independent reads and exact counts execute in parallel",()=>{
  const ui=read("assets/js/curator-ui.js");
  const curator=read("assets/js/curator.js");
  const load=ui.slice(ui.indexOf("  async load()"),ui.indexOf("  renderStats()"));
  const stats=curator.slice(curator.indexOf("export async function getCuratorStats"),curator.indexOf("// ============================================================\n// UTILITY FUNCTIONS"));
  assert.match(load,/Promise\.all/);
  assert.match(stats,/Promise\.all/);
  assert.equal((stats.match(/count:\s*"exact"/g)||[]).length,4);
});

test("comment rows use the joined post title even when its article is beyond page one",()=>{
  const admin=read("assets/js/admin.js");
  assert.match(admin,/post\?\.title \|\| comment\.posts\?\.title/);
});

test("admin cursor indexes cover all-status lists and paged request inboxes",()=>{
  const sql=read("supabase/migrations/20261125000100_admin_cursor_pagination_indexes.sql");
  for(const index of [
    "posts_admin_cursor_idx",
    "comments_admin_cursor_idx",
    "contact_requests_admin_cursor_idx",
    "support_requests_admin_cursor_idx",
    "newsletter_signups_admin_cursor_idx",
    "ad_applications_admin_cursor_idx",
    "admin_requests_admin_cursor_idx",
    "content_requests_admin_cursor_idx",
    "announcements_admin_cursor_idx"
  ]) assert.match(sql,new RegExp("CREATE INDEX IF NOT EXISTS "+index));
});

test("admin keyset pages keep nullable creation timestamps at the end",async()=>{
  const data=read("assets/js/data.js");
  assert.match(data,/created_at == null \? null : String\(cursor\.created_at\)/);
  assert.match(data,/created_at: last\.created_at/);
  assert.match(data,/query\.is\("created_at", null\)\.lt\("id", id\)/);
  assert.match(data,/query\.is\("created_at", null\)\.gt\("id", id\)/);
  assert.match(data,/created_at\.is\.null/);
  assert.match(data,/ascending: false, nullsFirst: false/);
  assert.match(data,/ascending: true, nullsFirst: false/);

  const posts=dataHarness(sampleRows);
  await posts.fetchAdminPostsPage({cursor:{created_at:null,id:id(22)}});
  assert.deepEqual(posts.calls[0].is,[["created_at",null]]);
  assert.deepEqual(posts.calls[0].lt,[["id",id(22)]]);

  const comments=dataHarness(sampleRows);
  await comments.fetchCommentModerationPage({cursor:{created_at:null,id:id(22)}});
  assert.deepEqual(comments.calls[0].is,[["created_at",null]]);
  assert.deepEqual(comments.calls[0].gt,[["id",id(22)]]);

  const queue=dataHarness(sampleRows);
  await queue.fetchAdminQueuePage("contact",{cursor:{created_at:null,id:id(22)}});
  assert.deepEqual(queue.calls[0].is,[["created_at",null]]);
  assert.deepEqual(queue.calls[0].lt,[["id",id(22)]]);
});
