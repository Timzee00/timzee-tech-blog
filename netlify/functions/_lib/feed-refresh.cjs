// Optional precomputation hook, disabled until staging validates the SQL and
// the personalized-feed read path consumes its cached candidates.
function allowedBatch(raw) {
  const n = Number(raw);
  return Number.isSafeInteger(n) ? Math.max(25, Math.min(n,250)) : 150;
}
async function maybeRefreshFeedCandidates(supabase, env = {}) {
  if (env.FEED_CANDIDATE_REFRESH_ENABLED !== "true") return { skipped: "disabled" };
  const { data, error } = await supabase.rpc("refresh_feed_candidate_scores", {
    p_max_per_type: allowedBatch(env.FEED_CANDIDATE_BATCH_SIZE)
  });
  if (error) throw error;
  return data || { skipped: "no_result" };
}
module.exports = { allowedBatch, maybeRefreshFeedCandidates };
