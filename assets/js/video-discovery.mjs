// Video-mode feed: reuse server-personalized/Follows ranking while requesting
// only the approved public video rows that correspond to its candidate IDs.
// Cache the bounded recommendation list for a short interval to avoid
// repeating expensive ranking RPCs every time the viewer scrolls.
const MAX_CANDIDATES = 50;
const TTL_MS = 45000;
const cache = new Map();
export async function fetchVideoDiscoveryPage(supabase, {
  mode = "for-you", offset = 0, limit = 12, force = false
} = {}) {
  if (!["for-you","following"].includes(mode)) throw Error("Unknown video feed mode");
  const start = Math.max(0,Math.trunc(Number(offset)||0));
  const size = Math.max(1,Math.min(25,Math.trunc(Number(limit)||12)));
  const key = mode;
  let entry = cache.get(key);
  if (force || !entry || Date.now()-entry.time >= TTL_MS) {
    const functionName = mode === "following" ? "get_following_feed" : "get_personalized_feed";
    const { data, error } = await supabase.rpc(functionName, {
      p_limit: MAX_CANDIDATES, p_content_type: "video"
    });
    if (error) throw error;
    const ids = [...new Set((data||[]).filter(row =>
      row?.content_type==="video" && typeof row.content_id==="string").map(row=>row.content_id))].slice(0,MAX_CANDIDATES);
    if (!ids.length) return [];
    const response = await supabase.from("videos").select("*")
      .eq("is_public",true).in("id",ids);
    if (response.error) throw response.error;
    const byId = new Map((response.data||[]).map(video=>[video.id,video]));
    const ordered = ids.map(id=>byId.get(id)).filter(Boolean);
    entry={time:Date.now(),rows:ordered};
    cache.set(key,entry);
  }
  return entry.rows.slice(start,start+size);
}
export function invalidateVideoDiscoveryCache() { cache.clear(); }
