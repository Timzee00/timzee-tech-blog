const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const getDiscovery=()=>import("../assets/js/video-discovery.mjs");
const videoHtml=read("video.html");
const viewSql=read("supabase/migrations/20261028222000_atomic_authenticated_video_views.sql");
const day=86400000,now=Date.parse("2026-10-28T21:00:00Z");
const video=(id,ago,likes=0,comments=0,views=0,userId=id)=>({
 id,user_id:userId,is_public:true,created_at:new Date(now-ago*day).toISOString(),
 like_count:likes,comment_count:comments,view_count:views
});

test("reel profile query explicitly loads username; verified byline does not expose email",()=>{
 assert.match(videoHtml,/\.select\("id, username, display_name, avatar_url, is_verified/);
 assert.match(videoHtml,/publicIdentityName\(profile,video\.author_name\|\|"Member"\)/);
 assert.match(videoHtml,/verifiedName\("@"\+uploaderName/);
 assert.doesNotMatch(videoHtml,/verifiedName\("@?"\+video\.author_name/);
});

test("ranking promotes real engagement but mixes fresh and low-exposure videos",async()=>{
 const {rankVideoCandidates}=await getDiscovery();
 const rows=[
  video("quiet",1),video("viral",8,9,6,45),video("low",2,0,0,2),
  video("middle",4,3,2,15),video("fresh",0),video("evergreen",30,5,3,130)
 ];
 const ranked=rankVideoCandidates(rows,now).map(v=>v.id);
 assert.equal(ranked[0],"viral","strong authentic engagement can outrank a newer upload");
 assert.equal(ranked[2],"fresh","new video appears between popular videos");
 assert.equal(new Set(ranked).size,rows.length,"no duplicate reels");
 assert.ok(ranked.includes("quiet")&&ranked.includes("low"),
  "smaller creators retain discovery opportunities");
 assert.deepEqual(ranked,rankVideoCandidates(rows,now).map(v=>v.id),
  "stable recommendations keep pagination consistent");
});

test("anonymous browsing and Following do not get unrelated feed results",async()=>{
 const {rankVideoCandidates,fetchVideoDiscoveryPage}=await getDiscovery();
 assert.deepEqual(rankVideoCandidates([{id:"one"},{id:"two"}]).map(v=>v.id),
  ["one","two"]);
 const calls=[];
 const supabase={rpc:async name=>{
   calls.push(name);return {data:[],error:null};
 },from:()=>{throw Error("Following must not fallback to public videos")}};
 const data=await fetchVideoDiscoveryPage(supabase,{
  mode:"following",userId:"viewer-reels-metrics-test",force:true
 });
 assert.deepEqual(data,[]);
 assert.deepEqual(calls,["get_following_feed"]);
});

test("fresh social totals enrich ranked candidates in one bounded RPC",async()=>{
 const {fetchVideoDiscoveryPage}=await getDiscovery();
 const candidates=[video("old",20,0,0,0),video("popular",4,0,0,6),
  video("new",0),video("medium",6,0,0,5)];
 const calls=[];
 const supabase={
  async rpc(name){
    calls.push(name);
    if(name==="get_personalized_feed")return {data:candidates.map(v=>({
       content_type:"video",content_id:v.id
    })),error:null};
    if(name==="video_social_counts")return {data:[
      {video_id:"popular",like_count:6,comment_count:4},
      {video_id:"medium",like_count:2,comment_count:1}
    ],error:null};
    throw Error("Unexpected RPC");
  },
  from(table){
    assert.equal(table,"videos");
    return {select(){return this},eq(){return this},
      async in(column,ids){
        return {data:ids.map(id=>candidates.find(v=>v.id===id)),error:null};
      }
    };
  }
 };
 const rows=await fetchVideoDiscoveryPage(supabase,{
  mode:"for-you",userId:"viewer-test-20261028",force:true
 });
 assert.equal(rows[0].id,"popular");
 assert.equal(rows[0].like_count,6);
 assert.deepEqual(calls,["get_personalized_feed","video_social_counts"]);
});

test("views require genuine visible playback and display updated server-accepted total",()=>{
 assert.match(videoHtml,/video\.addEventListener\("playing",/);
 assert.match(videoHtml,/document\.visibilityState==="hidden"/);
 assert.match(videoHtml,/state\.activeIndex!==Number\(el\.dataset\.index\)/);
 assert.match(videoHtml,/state\.viewAttempts\.add\(videoId\)/);
 assert.match(videoHtml,/await incrementVideoView\(videoId\)/);
 assert.match(videoHtml,/if\(credited\)\{/);
 assert.match(videoHtml,/state\.viewRetryAfter\.set\(videoId,Date\.now\(\)\+60000\)/);
 assert.match(videoHtml,/if\(!credited\)state\.viewAttempts\.delete\(videoId\)/);
 assert.match(videoHtml,/supabase\.rpc\("reel_public_metadata",\{p_video_ids:\[videoId\]\}\)/);
 assert.match(videoHtml,/current\.view_count=Math\.max\(0,Number\(current\.view_count\)\|\|0\)\+1/);
 assert.match(videoHtml,/id="viewcount-\$\{index\}"/);
});

test("inline For You videos also record legitimate plays without counting a scroll past",()=>{
 const fyp=read("assets/js/fyp.js");
 assert.match(fyp,/import \{incrementVideoView\} from "\.\/videos-marketplace\.js"/);
 assert.match(fyp,/video\.addEventListener\("playing",/);
 assert.match(fyp,/document\.visibilityState==="hidden"/);
 assert.match(fyp,/video\.paused\|\|!video\.isConnected/);
 assert.match(fyp,/incrementVideoView\(card\.dataset\.contentId\)/);
 assert.match(fyp,/\},2000\)/);
});

test("view counting uses an RLS-isolated atomic deduplicated database function",()=>{
 assert.match(viewSql,/SECURITY DEFINER/);
 assert.match(viewSql,/SET search_path=''/);
 assert.match(viewSql,/auth\.uid\(\)/);
 assert.match(viewSql,/IF viewer_id IS NULL/);
 assert.match(viewSql,/v\.is_public IS TRUE/);
 assert.match(viewSql,/PRIMARY KEY \(user_id, video_id, viewed_on\)/);
 assert.match(viewSql,/ON CONFLICT \(user_id,video_id,viewed_on\) DO NOTHING/);
 assert.match(viewSql,/REVOKE ALL ON TABLE app_private\.video_view_events FROM PUBLIC, anon, authenticated/);
 assert.match(viewSql,/GRANT EXECUTE ON FUNCTION public\.record_video_view\(uuid\) TO authenticated/);
 assert.doesNotMatch(viewSql,/GRANT EXECUTE ON FUNCTION public\.record_video_view\(uuid\) TO anon/);
});

test("server synchronizes actual likes and comments for candidate ranking",()=>{
 const sql=read("supabase/migrations/20261028223000_keep_video_engagement_counters_in_sync.sql");
 assert.match(sql,/CREATE TRIGGER videos_likes_count_sync/);
 assert.match(sql,/CREATE TRIGGER videos_comments_count_sync/);
 assert.match(sql,/AFTER INSERT OR DELETE OR UPDATE OF video_id ON public\.video_likes/);
 assert.match(sql,/AFTER INSERT OR DELETE OR UPDATE OF video_id ON public\.video_comments/);
 assert.match(sql,/SET like_count=\(SELECT count\(\*\)::integer FROM public\.video_likes/);
 assert.match(sql,/comment_count=\(SELECT count\(\*\)::integer FROM public\.video_comments/);
 assert.match(sql,/REVOKE ALL ON FUNCTION app_private\.adjust_video_like_counter\(\) FROM PUBLIC,anon,authenticated/);
 assert.match(sql,/SECURITY DEFINER SET search_path=''/);
});
