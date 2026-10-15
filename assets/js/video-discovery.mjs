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

export async function fetchVideoDiscoveryPage(supabase, {
  mode = "for-you", userId = null, offset = 0, limit = 12, force = false
} = {}) {
  if (!["for-you", "following"].includes(mode)) throw Error("Unknown video feed mode");
  const start = Math.max(0, Math.trunc(Number(offset) || 0));
  const size = Math.max(1, Math.min(25, Math.trunc(Number(limit) || 12)));
  const key = mode + ":" + (userId || "guest");
  let entry = cache.get(key);

  if (force || !entry || Date.now() - entry.time >= TTL_MS) {
    const functionName = mode === "following" ? "get_following_feed" : "get_personalized_feed";
    const { data, error } = await supabase.rpc(functionName, {
      p_limit: MAX_CANDIDATES, p_content_type: "video"
    });

    if (error && !(mode === "for-you" && isMissingFeedFunction(error))) {
      throw error; // Never turn denied Following requests into public video lists.
    }

    const ids = [...new Set((data || [])
      .filter(row => row?.content_type === "video" && typeof row.content_id === "string")
      .map(row => row.content_id))].slice(0, MAX_CANDIDATES);

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
