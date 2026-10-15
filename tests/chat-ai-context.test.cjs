const { test } = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../assets/js/chat-ai-context.mjs');
function storage() { const values = new Map(); return { get length() { return values.size; }, key: i => [...values.keys()][i], getItem: k => values.get(k) || null, setItem: (k,v) => values.set(k,v), removeItem: k => values.delete(k) }; }
test('selected chat context is a single-use handoff bound to the current user', async () => {
  const { storeChatContext, takeChatContext } = await modulePromise; const memory = storage();
  const id = storeChatContext('Private message: 100% accurate', 'A', memory, 1000);
  assert.match(id, /^[a-f0-9-]{36}$/); assert.equal(takeChatContext(id, 'A', memory, 1001), 'Private message: 100% accurate');
  assert.equal(takeChatContext(id, 'A', memory, 1002), '');
  const other = storeChatContext('private', 'A', memory, 1000);
  assert.equal(takeChatContext(other, 'B', memory, 1001), ''); assert.equal(memory.length, 0);
});
test('expired context is discarded and interrupted handoffs are cleaned up', async () => {
  const { storeChatContext, takeChatContext } = await modulePromise; const memory = storage();
  const old = storeChatContext('old', 'A', memory, 1000);
  assert.equal(takeChatContext(old, 'A', memory, 301001), '');
  storeChatContext('stale', 'A', memory, 1000); storeChatContext('new', 'A', memory, 301001);
  assert.equal(memory.length, 1);
});
test('oversized messages and unavailable storage fail before navigation', async () => {
  const { storeChatContext } = await modulePromise;
  assert.throws(() => storeChatContext('x'.repeat(12001), 'A', storage()), /shorter/);
  assert.throws(() => storeChatContext('private', 'A', { length: 0, setItem() { throw new Error('Storage disabled'); } }), /Storage disabled/);
});
