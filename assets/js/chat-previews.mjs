// Fetch the newest message for each DM thread without downloading entire
// conversations. With the reviewed SQL function installed, this is one
// server-side indexed lookup per thread in a batch. Until then, use bounded
// concurrent single-row queries to preserve correct previews on old releases.
const FIELDS = "id,thread_id,body,media_type,created_at,sender_id";
const BATCH = 64;
const CONCURRENCY = 5;

function missingRpc(error) {
  return ["PGRST202", "42883"].includes(String(error?.code || ""));
}
function distinctThreadIds(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter(
    id => typeof id === "string" && id.length > 0 && id.length <= 180
  ))];
}
async function fetchFallback(supabase, ids) {
  const previews = new Map();
  let next = 0;
  async function worker() {
    while (next < ids.length) {
      const id = ids[next++];
      const { data, error } = await supabase.from("direct_messages")
        .select(FIELDS)
        .eq("thread_id", id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1);
      if (error) throw error; // Do not silently hide permission or outages.
      if (data?.[0]) previews.set(id, data[0]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, () => worker()));
  return previews;
}

export async function loadLatestThreadPreviews(supabase, threadIds = []) {
  const unique = distinctThreadIds(threadIds);
  if (!unique.length) return new Map();
  const previews = new Map();
  const batches = [];
  for (let start = 0; start < unique.length; start += BATCH) {
    batches.push(unique.slice(start, start + BATCH));
  }

  // Keep RPC fan-out bounded while allowing independent batches to overlap.
  // Large contact lists no longer pay one round-trip per 64-thread batch.
  const responses = new Array(batches.length);
  let nextBatch = 0;
  async function worker() {
    while (nextBatch < batches.length) {
      const index = nextBatch++;
      responses[index] = await supabase.rpc("get_direct_message_previews", {
        p_thread_ids: batches[index]
      });
    }
  }
  await Promise.all(Array.from(
    { length: Math.min(CONCURRENCY, batches.length) },
    () => worker()
  ));

  for (let index = 0; index < responses.length; index++) {
    const response = responses[index];
    if (response.error) {
      if (!missingRpc(response.error)) throw response.error;
      // Older databases without the optional function still work without
      // transferring full chat histories to every browser.
      return fetchFallback(supabase, unique);
    }
    const allowed = new Set(batches[index]);
    for (const item of response.data || []) {
      if (allowed.has(item?.thread_id)) previews.set(item.thread_id, item);
    }
  }
  return previews;
}
