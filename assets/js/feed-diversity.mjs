// Lightweight diversification on a bounded list already ranked in Postgres.
// This is NOT a machine-learned model or a substitute for cached candidates.
const SAFE_TYPES = new Set(["post", "discussion", "video", "novel", "marketplace"]);
export function diversifyFeed(rows, { mode = "for-you", headSize = 12 } = {}) {
  const unique = [], seen = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row || !SAFE_TYPES.has(row.content_type) || !row.content_id) continue;
    const key = row.content_type + ":" + row.content_id;
    if (seen.has(key)) continue;
    seen.add(key); unique.push(row);
  }
  if (mode !== "for-you" || unique.length < 5) return unique;
  const selected = [], postponed = [], authors = new Map(), types = new Map();
  const target = Math.min(Math.max(1, Math.floor(headSize)), unique.length);
  for (const row of unique) {
    if (selected.length >= target) { postponed.push(row); continue; }
    const author = row.author_id || null;
    const authorCount = author ? (authors.get(author) || 0) : 0;
    const typeCount = types.get(row.content_type) || 0;
    if ((author && authorCount >= 2) || typeCount >= Math.ceil(target * .50)) {
      postponed.push(row); continue;
    }
    selected.push(row);
    if (author) authors.set(author, authorCount + 1);
    types.set(row.content_type, typeCount + 1);
  }
  // Every server-approved candidate remains eligible; constraints only
  // diversify the first viewport instead of dropping legitimate content.
  const remainder = unique.filter(row => !selected.includes(row));
  return [...selected, ...remainder];
}

export function feedCacheKey(mode, type) {
  return String(mode) + ":" + String(type);
}
export function cachedFeed(cache, key, now = Date.now(), ttlMs = 45000) {
  const item = cache.get(key);
  return item && now - item.time >= 0 && now - item.time < ttlMs ? item.rows : null;
}
