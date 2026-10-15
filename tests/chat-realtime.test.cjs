const { test } = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../assets/js/chat-realtime.mjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
async function fixture() {
  const { createChatRealtime } = await modulePromise;
  const channels = [], removed = [], statuses = [], messages = [], timers = new Map();
  let timerId = 0, online = true;
  const client = {
    channel(name) {
      const channel = { name, handlers: [], on(type, filter, fn) { this.handlers.push({ type, filter, fn }); return this; }, subscribe(fn) { this.status = fn; return this; } };
      channels.push(channel); return channel;
    },
    async removeChannel(channel) { removed.push(channel); channel.status('CLOSED'); }
  };
  const realtime = createChatRealtime(client, { onStatus: s => statuses.push(s), onMessage: (...args) => messages.push(args), canConnect: () => online,
    randomId: () => String(channels.length), random: () => 0,
    setTimer: (fn, delay) => { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimer: id => timers.delete(id) });
  return { realtime, channels, removed, statuses, messages, timers, offline: () => online = false };
}
test('switching conversations retires the old channel and ignores stale callbacks', async () => {
  const f = await fixture(); await f.realtime.start('A'); const first = f.channels[0];
  first.status('SUBSCRIBED'); await f.realtime.start('B');
  first.status('CHANNEL_ERROR'); first.handlers[0].fn({ new: { thread_id: 'A', id: 'old' } });
  assert.equal(f.channels.length, 2); assert.deepEqual(f.removed, [first]); assert.deepEqual(f.messages, []);
  assert.equal(f.statuses.at(-1), 'connecting');
  f.channels[1].status('SUBSCRIBED'); assert.equal(f.statuses.at(-1), 'connected');
  assert.deepEqual(f.channels[1].handlers.map(h => h.type), ['postgres_changes', 'postgres_changes']);
  await f.realtime.stop(); assert.equal(f.timers.size, 0);
});
test('failed subscriptions retire before bounded backoff; stop cancels retries', async () => {
  const f = await fixture(); await f.realtime.start('A');
  f.channels[0].status('CHANNEL_ERROR'); f.channels[0].status('CLOSED'); await tick();
  assert.equal(f.timers.size, 1); assert.equal(f.statuses.at(-1), 'reconnecting');
  const [id, timer] = [...f.timers][0]; assert.equal(timer.delay, 1500); f.timers.delete(id); timer.fn(); await tick();
  assert.equal(f.channels.length, 2); assert.equal(f.removed.length, 1);
  f.channels[1].status('TIMED_OUT'); await tick(); assert.equal([...f.timers.values()][0].delay, 3000);
  await f.realtime.stop(); assert.equal(f.timers.size, 0);
});
test('offline state does not create retry storms or pretend to be connected', async () => {
  const f = await fixture(); f.offline(); await f.realtime.start('A');
  assert.equal(f.channels.length, 0); assert.equal(f.timers.size, 0); assert.equal(f.statuses.at(-1), 'offline');
});
test('updates from another conversation are ignored and late status cannot revive a stopped channel', async () => {
  const f = await fixture(); await f.realtime.start('A'); const channel = f.channels[0];
  channel.handlers[1].fn({ new: { thread_id: 'B', id: 'wrong' } });
  channel.handlers[1].fn({ new: { thread_id: 'A', id: 'right' } }); await tick();
  assert.equal(f.messages.length, 1); assert.equal(f.messages[0][0], 'UPDATE');
  await f.realtime.stop(); const previous = f.statuses.at(-1); channel.status('SUBSCRIBED');
  assert.equal(f.statuses.at(-1), previous);
});
test('rapid switches during channel retirement create only the latest subscription', async () => {
  const { createChatRealtime } = await modulePromise;
  const names = []; let release;
  const retirement = new Promise(resolve => { release = resolve; });
  const client = { channel(name) { names.push(name); return { on() { return this; }, subscribe() {} }; }, removeChannel: () => retirement };
  const realtime = createChatRealtime(client, { randomId: () => 'test', setTimer: () => 0, clearTimer: () => {} });
  await realtime.start('A'); const second = realtime.start('B'); const third = realtime.start('C');
  await tick(); assert.deepEqual(names, ['timzee-chat-A-test']);
  release(); await Promise.all([second, third]);
  assert.deepEqual(names, ['timzee-chat-A-test', 'timzee-chat-C-test']);
  await realtime.stop();
});
