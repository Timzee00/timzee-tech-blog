import {syncObservedRegion} from "./observed-region.mjs";
// Page-local recommendation cache. Each viewer and feed mode is isolated.
// An empty Following list is valid and must not be replaced with Latest.
const MAX_CANDIDATES = 50;
const TTL_MS = 45000;
const MAX_CACHE_ENTRIES = 16;
const cache = new Map();

function isMissingFeedFunction(error) {
  return ["PGRST202", "42883"].includes(String(error?.code || ""));
}

async function fetchPublicVideoFallback(supabase) {
  const { data, error } = await supabase.from("videos")
    .select("*")
    .eq("is_public", true)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(0, MAX_CANDIDATES - 1);
  if (error) throw error;
  return data || [];
}

// Balanced, stable For You recommendations: real likes/comments, meaningful
// views and freshness all matter. Keep some recent and emerging creators
// between stronger clips rather than sorting exclusively by upload date.
// Ranking uses only the already-authorized public candidate set.
export function rankVideoCandidates(candidates,now=Date.now()){
  const rows=Array.isArray(candidates)?candidates:[];
  if(rows.length<3)return [...rows];
  const score=video=>{
    const views=Math.max(0,Number(video.view_count)||0);
    const likes=Math.max(0,Number(video.like_count)||0);
    const comments=Math.max(0,Number(video.comment_count)||0);
    const ageDays=Number.isFinite(Date.parse(video.created_at))?
      Math.max(0,(now-Date.parse(video.created_at))/86400000):30;
    const freshness=3.5*Math.exp(-ageDays/12);
    const activity=Math.log1p(views)*0.8+
      Math.log1p(likes)*4.8+Math.log1p(comments)*6.4;
    const engagement=Math.min(2,(likes+2*comments)/Math.max(5,views)*2);
    return activity+engagement+freshness;
  };
  // If this is an older/mocked feed with no usable metrics or timestamps,
  // preserve the ranked order returned by Supabase.
  if(!rows.some(v=>Number(v.like_count)>0||Number(v.comment_count)>0||
    Number(v.view_count)>0||Number.isFinite(Date.parse(v.created_at))))return [...rows];
  const popular=[...rows].sort((a,b)=>score(b)-score(a)||
    (Date.parse(b.created_at)||0)-(Date.parse(a.created_at)||0));
  const newest=[...rows].sort((a,b)=>(Date.parse(b.created_at)||0)-
    (Date.parse(a.created_at)||0));
  // Reserve a discovery lane for the bottom half of *eligible* public
  // candidates, preventing popular videos from also consuming every
  // exploration slot. Activity and recency decide order within that lane.
  const emerging=popular.slice(Math.max(1,Math.floor(popular.length*0.5)))
    .sort((a,b)=>
      (score(b)-Math.log1p(Math.max(0,Number(b.view_count)||0))*0.65)-
      (score(a)-Math.log1p(Math.max(0,Number(a.view_count)||0))*0.65));
  const lanes=[popular,popular,newest,popular,emerging];
  const seen=new Set(),result=[];
  for(let i=0;result.length<rows.length&&i<rows.length*3;i++){
    const lane=lanes[i%lanes.length];
    let next=lane.find(v=>!seen.has(v.id)&&
      (!result.length||v.user_id!==result[result.length-1].user_id));
    if(!next)next=lane.find(v=>!seen.has(v.id));
    if(!next)break;
    seen.add(next.id);result.push(next);
  }
  return result;
}

export async function fetchVideoDiscoveryPage(supabase, {
  mode = "for-you", userId = null, offset = 0, limit = 12, force = false
} = {}) {
  if (!["for-you", "following"].includes(mode)) throw Error("Unknown video feed mode");
  const start = Math.max(0, Math.trunc(Number(offset) || 0));
  const size = Math.max(1, Math.min(25, Math.trunc(Number(limit) || 12)));
  const key = mode + ":" + (userId || "guest");
  let entry = cache.get(key);

  if (force || !entry || Date.now() - entry.time >= TTL_MS) {
    // The light RPC searches a compact 15-minute candidate pool rather than
    // recomputing whole-catalog engagement totals on every swipe.
    // Preserve the legacy feed only for deployments missing the new RPC.
    if(userId)await syncObservedRegion(supabase);
    const quick = await supabase.rpc("blipmood_video_feed_ids", {
      p_mode: mode, p_limit: MAX_CANDIDATES
    });
    const useQuick = !quick.error;
    let error = quick.error;
    let data = [];
    if (!useQuick) {
      if (!isMissingFeedFunction(quick.error)) throw quick.error;
      const functionName = mode === "following" ? "get_following_feed" : "get_personalized_feed";
      const legacy = await supabase.rpc(functionName, {
        p_limit: MAX_CANDIDATES, p_content_type: "video"
      });
      error = legacy.error;
      data = legacy.data || [];
      if (error && !(mode === "for-you" && isMissingFeedFunction(error))) {
        throw error; // Never turn denied Following requests into public video lists.
      }
    }
    const ids = [...new Set((useQuick ? (quick.data || [])
      .map(row => row?.video_id) : data
      .filter(row => row?.content_type === "video")
      .map(row => row.content_id))
      .filter(id => typeof id === "string"))].slice(0, MAX_CANDIDATES);

    let rows;
    if (mode === "for-you" && (!ids.length || isMissingFeedFunction(error))) {
      // Cold-start recommendations: show recent public videos when there are
      // no scored candidates yet. Preserve the server's public visibility RLS.
      rows = await fetchPublicVideoFallback(supabase);
    } else if (!ids.length) {
      rows = []; // A creator-following feed should stay empty until you follow.
    } else {
      const response = await supabase.from("videos")
        .select("*").eq("is_public", true).in("id", ids);
      if (response.error) throw response.error;
      const byId = new Map((response.data || []).map(video => [video.id, video]));
      rows = ids.map(id => byId.get(id)).filter(Boolean);
    }

    if(mode==="for-you"&&!useQuick&&rows.length>1){
      // Stored videos.like_count/comment_count can lag behind actual
      // reactions. Read the same live aggregate used by the visible reel
      // counters before ranking. A failing aggregate must not hide videos.
      try{
        const ids=rows.slice(0,MAX_CANDIDATES).map(v=>v.id);
        const counts=await supabase.rpc("video_social_counts",{p_video_ids:ids});
        if(!counts.error&&Array.isArray(counts.data)){
          const byId=new Map(counts.data.map(v=>[v.video_id,v]));
          rows=rows.map(v=>{
            const current=byId.get(v.id);
            return current?{...v,like_count:Number(current.like_count)||0,
              comment_count:Number(current.comment_count)||0}:v;
          });
        }
      }catch(error){console.warn("Unable to refresh reel ranking signals",error);}
      rows=rankVideoCandidates(rows);
    }
    entry = { time: Date.now(), rows };
    if (cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = cache.keys().next().value;
      cache.delete(oldest);
    }
    cache.set(key, entry);
  }
  return entry.rows.slice(start, start + size);
}

export function invalidateVideoDiscoveryCache() { cache.clear(); }
