// Memory-only, short-lived reuse. Every cache miss still uses the authorized
// signing endpoint; URLs and credentials are never persisted by this cache.
export function createSignedMediaCache({ sign, expiresAt, now = Date.now, concurrency = 4, capacity = 128 }) {
  const cache = new Map(), pending = new Map(), queue = [];
  let session = '', generation = 0, active = 0;
  function setSession(token = '') {
    if (token === session) return;
    session = token; generation++; cache.clear(); pending.clear();
    for (const job of queue.splice(0)) job.reject(new Error('Media session changed.'));
  }
  function drain() {
    while (active < concurrency && queue.length) {
      const job = queue.shift(); active++;
      Promise.resolve().then(job.run).then(job.resolve, job.reject).finally(() => { active--; drain(); });
    }
  }
  function get(path, token) {
    if (!token) return Promise.reject(new Error('Sign in to open private media.'));
    setSession(token);
    const cached = cache.get(path);
    if (cached && cached.until > now()) {
      cache.delete(path); cache.set(path, cached);
      return Promise.resolve(cached.url);
    }
    cache.delete(path);
    if (pending.has(path)) return pending.get(path);
    const version = generation;
    const request = new Promise((resolve, reject) => {
      queue.push({ resolve, reject, async run() {
        if (version !== generation) throw new Error('Media session changed.');
        const url = await sign(path, token);
        if (version !== generation) throw new Error('Media session changed.');
        // Do not reuse nearly expired or malformed URLs. At most one minute of
        // reuse limits stale grants and bounds the in-memory working set.
        const until = Math.min(now() + 60000, expiresAt(url) - 600000);
        if (!Number.isFinite(until) || until <= now()) throw new Error('Media link has expired. Please retry.');
        cache.set(path, { url, until });
        while (cache.size > capacity) cache.delete(cache.keys().next().value);
        return url;
      } });
    });
    pending.set(path, request);
    const cleanup = () => { if (pending.get(path) === request) pending.delete(path); };
    request.then(cleanup, cleanup); drain(); return request;
  }
  return { get, setSession };
}
