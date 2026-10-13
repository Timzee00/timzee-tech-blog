const test = require("node:test");
const assert = require("node:assert/strict");
const { loadLatestThreadPreviews } = await import("../assets/js/chat-previews.mjs");

test("RPC reads only distinct thread IDs in bounded batches", async () => {
  const requests = [];
  const supabase = {
    rpc: async (name, data) => {
      requests.push({ name, ids: data.p_thread_ids });
      return { data: data.p_thread_ids.map(thread_id => ({ thread_id, body: "last" })), error: null };
    },
    from: () => { throw Error("Fallback should not be used"); }
  };
  const ids = Array.from({length: 130}, (_, n) => "thread-" + n);
  const result = await loadLatestThreadPreviews(supabase, [...ids, ids[0]]);
  assert.equal(result.size, 130);
  assert.deepEqual(requests.map(item => item.ids.length), [64, 64, 2]);
  assert.ok(requests.every(item => item.name === "get_direct_message_previews"));
});

test("pre-migration fallback asks for one row per thread with concurrency cap", async () => {
  const pending = [];
  let inFlight = 0, max = 0;
  const supabase = {
    rpc: async () => ({ error: { code: "PGRST202" } }),
    from: table => {
      assert.equal(table, "direct_messages");
      const query = { thread: "" };
      return {
        select(fields) { assert.equal(fields, "id,thread_id,body,media_type,created_at,sender_id"); return this; },
        eq(column, id) { assert.equal(column, "thread_id"); query.thread = id; return this; },
        order() { return this; },
        async limit(count) {
          assert.equal(count, 1);
          inFlight++; max = Math.max(max, inFlight);
          await Promise.resolve();
          inFlight--;
          return { data: [{ thread_id: query.thread, body: "preview" }], error: null };
        }
      };
    }
  };
  const ids = Array.from({length: 19}, (_, n) => "thread-" + n);
  const result = await loadLatestThreadPreviews(supabase, ids);
  assert.equal(result.size, 19);
  assert.ok(max <= 5 && max > 1, "Concurrency must stay bounded");
});

test("permission errors cannot be disguised as empty chats", async () => {
  await assert.rejects(
    loadLatestThreadPreviews({rpc: async () => ({ error: { code:"42501", message:"No access" } })}, ["thread"]),
    error => error.code === "42501"
  );
});
