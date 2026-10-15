const { test } = require('node:test');
const assert = require('node:assert/strict');
const modulePromise = import('../assets/js/signed-media-cache.mjs');
const tick = () => new Promise(resolve => setImmediate(resolve));
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve; }); return { promise, release }; };
async function fixture(options = {}) {
  const { createSignedMediaCache } = await modulePromise;
  let clock = 1000000; const calls = [];
  const cache = createSignedMediaCache({ sign: async (path, token) => { calls.push({ path, token }); return 'url:' + path; }, expiresAt: () => clock + 3600000, now: () => clock, ...options });
  return { cache, calls, advance: ms => { clock += ms; } };
}
test('duplicate media requests share one signing call and reuse only briefly', async () => {
  const f = await fixture();
  assert.deepEqual(await Promise.all([f.cache.get('a', 'user'), f.cache.get('a', 'user')]), ['url:a', 'url:a']);
  await f.cache.get('a', 'user'); assert.equal(f.calls.length, 1);
  f.advance(60001); await f.cache.get('a', 'user'); assert.equal(f.calls.length, 2);
});
test('different sessions cannot reuse signed URLs and logout invalidates in-flight work', async () => {
  const blocked = gate(); let calls = 0;
  const f = await fixture({ sign: async () => { calls++; if (calls === 1) await blocked.promise; return 'fresh'; } });
  const old = f.cache.get('a', 'first'); const rejection = assert.rejects(old, /session changed/);
  await tick(); f.cache.setSession(''); blocked.release(); await rejection;
  await f.cache.get('a', 'second'); assert.equal(calls, 2);
  await assert.rejects(f.cache.get('a', ''), /Sign in/);
});
test('signing failures are not cached and a later attempt can succeed', async () => {
  let calls = 0; const f = await fixture({ sign: async () => { if (++calls === 1) throw new Error('offline'); return 'fresh'; } });
  await assert.rejects(f.cache.get('a', 'user'), /offline/);
  assert.equal(await f.cache.get('a', 'user'), 'fresh'); assert.equal(calls, 2);
});
test('near-expiry and malformed URLs cannot create a refresh loop', async () => {
  for (const expiry of [0, NaN, 1000001]) {
    const f = await fixture({ expiresAt: () => expiry });
    await assert.rejects(f.cache.get('a', 'user'), /expired/);
  }
});
test('parallel signing is bounded and logout drops queued requests', async () => {
  const blocked = gate(); let active = 0, peak = 0, calls = 0;
  const f = await fixture({ concurrency: 2, sign: async () => { calls++; peak = Math.max(peak, ++active); await blocked.promise; active--; return 'fresh'; } });
  const work = Array.from({ length: 6 }, (_, i) => f.cache.get(String(i), 'user'));
  const completed = Promise.allSettled(work);
  await tick(); assert.equal(calls, 2); f.cache.setSession(''); blocked.release();
  const results = await completed; assert.equal(peak, 2); assert.equal(calls, 2);
  assert.ok(results.every(r => r.status === 'rejected'));
});
test('memory cache evicts older entries at its capacity', async () => {
  const f = await fixture({ capacity: 2 });
  await f.cache.get('a', 'user'); await f.cache.get('b', 'user'); await f.cache.get('c', 'user');
  await f.cache.get('a', 'user'); assert.equal(f.calls.length, 4);
});
