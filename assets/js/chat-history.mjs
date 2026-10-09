export const MESSAGE_PAGE_SIZE = 50;

export async function fetchMessagePage(client, threadId, before = null) {
  let query = client.from("direct_messages").select("*").eq("thread_id", threadId)
    .order("created_at", { ascending: false }).order("id", { ascending: false })
    .limit(MESSAGE_PAGE_SIZE);
  if (before) {
    // Quote filter values, including timestamps, rather than interpolating raw
    // text into PostgREST's filter grammar. The id breaks timestamp ties.
    const time = JSON.stringify(String(before.created_at));
    const id = JSON.stringify(String(before.id));
    query = query.or(`created_at.lt.${time},and(created_at.eq.${time},id.lt.${id})`);
  }
  const { data, error } = await query;
  if (error) throw error;
  const rows = data || [];
  return {
    messages: [...rows].reverse(),
    cursor: rows.length ? { created_at: rows.at(-1).created_at, id: rows.at(-1).id } : before,
    hasMore: rows.length === MESSAGE_PAGE_SIZE
  };
}
