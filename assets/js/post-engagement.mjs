// Exact engagement for only the article IDs on the current screen. The RPC
// returns aggregate counts under Postgres RLS, without sending all likes or
// comments to every browser. A bounded exact-count fallback preserves old DBs.
const MAX_BATCH = 24;
const FALLBACK_WORKERS = 4;
function distinctIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter(id =>
    typeof id === "string" && /^[0-9a-f-]{36}$/i.test(id)))];
}
export async function fetchPostEngagement(supabase, postIds, currentUserId = null) {
  const ids = distinctIds(postIds);
  const result = { likeCounts: {}, commentCounts: {}, likedPostIds: [] };
  if (!ids.length) return result;
  const liked = new Set();
  for (let start = 0; start < ids.length; start += MAX_BATCH) {
    const batch = ids.slice(start, start + MAX_BATCH);
    const { data, error } = await supabase.rpc("get_post_engagement", { p_post_ids: batch });
    if (!error) {
      for (const row of data || []) {
        if (!batch.includes(row.post_id)) continue;
        result.likeCounts[row.post_id] = Number(row.like_count || 0);
        result.commentCounts[row.post_id] = Number(row.comment_count || 0);
        if (row.liked_by_me) liked.add(row.post_id);
      }
      continue;
    }
    if (!["PGRST202", "42883"].includes(String(error.code || ""))) throw error;
    const missing = ids.slice(start); // Older schema; no further RPC attempts.
    let cursor = 0;
    async function worker() {
      while (cursor < missing.length) {
        const postId = missing[cursor++];
        const [likes, comments] = await Promise.all([
          supabase.from("post_likes").select("id", { count: "exact", head: true }).eq("post_id", postId),
          supabase.from("comments").select("id", { count: "exact", head: true }).eq("post_id", postId).eq("status", "approved")
        ]);
        if (likes.error) throw likes.error;
        if (comments.error) throw comments.error;
        result.likeCounts[postId] = likes.count || 0;
        result.commentCounts[postId] = comments.count || 0;
      }
    }
    await Promise.all(Array.from({ length: Math.min(FALLBACK_WORKERS, missing.length) }, () => worker()));
    if (currentUserId) {
      const { data: userLikes, error: userError } = await supabase.from("post_likes")
        .select("post_id")
        .eq("user_id", currentUserId)
        .in("post_id", ids);
      if (userError) throw userError;
      for (const row of userLikes || []) liked.add(row.post_id);
    }
    break;
  }
  result.likedPostIds = [...liked];
  return result;
}
