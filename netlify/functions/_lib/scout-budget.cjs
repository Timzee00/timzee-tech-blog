// Bound curator work per scheduled invocation and rotate oldest sources first.
const MAX_SOURCES = 4;
const MAX_ITEMS_PER_SOURCE = 6;
const MAX_ARTICLES_INSPECTED = 30;
// Reject example feed URLs and local/private hosts from Netlify fallback settings.
function isUsableScoutFeedUrl(raw) {
  try {
    const url = new URL(String(raw || "").trim());
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || !host.includes(".")) return false;
    if (/^(?:localhost|.*\.localhost|(?:site[123]|example)\.(?:com|org|net)|.*\.example)$/.test(host)) return false;
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(":") || host.endsWith(".local")) return false;
    return true;
  } catch { return false; }
}
function scoutSourceFlags(source) {
  const tags=new Set((Array.isArray(source?.tags)?source.tags:[]).map(v=>String(v).toLowerCase().trim()));
  const cat=String(source?.category||"").toLowerCase().trim();
  const name=String(source?.name||"").toLowerCase();
  const url=String(source?.feed_url||"");
  return {
    local:tags.has("nigeria")||cat==="nigeria",
    sport:tags.has("sports")||tags.has("football")||["sports","football"].includes(cat)||
      /\b(?:sports?|football)\b/.test(name)||/\/sport(?:\/|s\/|\.)/.test(url)
  };
}
function clampScoutItems(value) {
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? Math.max(1, Math.min(MAX_ITEMS_PER_SOURCE, n)) : 5;
}
function scheduleScoutSources(sources, maxSources = MAX_SOURCES) {
  const unique = new Map();
  for (const source of sources || []) {
    if (!source?.id || source.enabled === false || !source.feed_url) continue;
    if (!unique.has(source.id)) unique.set(source.id, source);
  }
  const oldest=[...unique.values()].sort((a,b)=>{
    const t1=a.last_fetched_at?Date.parse(a.last_fetched_at):0;
    const t2=b.last_fetched_at?Date.parse(b.last_fetched_at):0;
    return (Number.isFinite(t1)?t1:0)-(Number.isFinite(t2)?t2:0)
      || String(a.id).localeCompare(String(b.id));
  });
  const max=Math.max(1,Math.min(MAX_SOURCES,Math.trunc(maxSources)||MAX_SOURCES));
  const chosen=[],used=new Set();
  const take=condition=>{
    const next=oldest.find(source=>!used.has(source.id)&&condition(scoutSourceFlags(source)));
    if(next){chosen.push(next);used.add(next.id);}
  };
  // One Nigerian (non-sports), one sports, one global/general; then oldest.
  // Keep sorting within each lane so every enabled source eventually rotates.
  if(max>=3){
    take(flags=>flags.local&&!flags.sport);
    take(flags=>flags.sport);
    take(flags=>!flags.local&&!flags.sport);
  }else if(max>=2){
    take(flags=>flags.local);
    take(flags=>flags.sport);
  }
  for(const source of oldest){
    if(chosen.length>=max)break;
    if(!used.has(source.id)){chosen.push(source);used.add(source.id);}
  }
  return chosen;
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
// Unknown or invalid source timestamps are retained for editorial review.
// Known old dates, including GDELT compact timestamps, are skipped before import.
function isStaleScoutItem(item,{now=Date.now(),maxAgeDays=7}={}){
  if(!item?.published_at)return false;
  const timestamp=Date.parse(normalizeScoutDate(item.published_at,new Date(now)));
  if(!Number.isFinite(timestamp))return false;
  return now-timestamp>maxAgeDays*86400000;
}
module.exports={clampScoutItems,scheduleScoutSources,scoutSourceFlags,isUsableScoutFeedUrl,classifyScoutSource,normalizeScoutDate,normalizeScoutArticleUrl,isStaleScoutItem,SCOUT_LIMITS};
