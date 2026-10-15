// Bound curator work per scheduled invocation and rotate oldest sources first.
const MAX_SOURCES = 4;
const MAX_ITEMS_PER_SOURCE = 6;
const MAX_ARTICLES_INSPECTED = 30;
function isDemoFeedUrl(value) {
 try {const u=new URL(String(value||"").trim()),h=u.hostname.toLowerCase(),p=u.pathname.replace(/\/$/,"");
  return h.endsWith(".example")||["example.com","example.net","example.org"].includes(h)||
   (h==="site1.com"&&p==="/rss")||(h==="site2.com"&&p==="/feed")||(h==="site3.com"&&p==="/tips.rss");
 }catch{return false;}
}
function clampScoutItems(value) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_ITEMS_PER_SOURCE, n)) : 5;
}
function scheduleScoutSources(sources, maxSources = MAX_SOURCES) {
  const unique = new Map();
  for (const source of sources || []) {
    if (!source?.id || source.enabled === false || !source.feed_url || isDemoFeedUrl(source.feed_url)) continue;
    if (!unique.has(source.id)) unique.set(source.id, source);
  }
  return [...unique.values()].sort((a,b) => {
    const t1 = a.last_fetched_at ? Date.parse(a.last_fetched_at) : 0;
    const t2 = b.last_fetched_at ? Date.parse(b.last_fetched_at) : 0;
    return (Number.isFinite(t1) ? t1 : 0) - (Number.isFinite(t2) ? t2 : 0)
      || String(a.id).localeCompare(String(b.id));
  }).slice(0,Math.max(1,Math.min(MAX_SOURCES,Math.trunc(maxSources)||MAX_SOURCES)));
}
const SCOUT_LIMITS = Object.freeze({ MAX_SOURCES, MAX_ITEMS_PER_SOURCE, MAX_ARTICLES_INSPECTED });

function classifyScoutSource({ fetched = false, inserts = 0, duplicates = 0, errors = [] } = {}) {
  if (!fetched) return "failed";
  if (errors.length && inserts === 0 && duplicates === 0) return "failed";
  if (errors.length) return "partial";
  if (inserts) return "imported";
  if (duplicates) return "already_imported";
  return "empty_feed";
}
function normalizeScoutDate(input, fallback = new Date()) {
  if (!input) return fallback.toISOString();
  const raw = String(input).trim();
  // GDELT often uses compact dates such as 20261013T183000Z, which Postgres
  // cannot reliably parse as a timestamp without timezone.
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})T?(\d{2})(\d{2})(\d{2})Z?$/);
  const normalized = compact
    ? `${compact[1]}-${compact[2]}-${compact[3]}T${compact[4]}:${compact[5]}:${compact[6]}Z`
    : raw;
  const parsed = new Date(normalized);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : fallback.toISOString();
}
function normalizeScoutArticleUrl(raw) {
  try {
    const url = new URL(String(raw || "").trim());
    if (!["https:", "http:"].includes(url.protocol) || !url.hostname) return "";
    url.hash = "";
    return url.toString();
  } catch { return ""; }
}
module.exports={clampScoutItems,scheduleScoutSources,classifyScoutSource,normalizeScoutDate,normalizeScoutArticleUrl,isDemoFeedUrl,SCOUT_LIMITS};
