const Parser = require("rss-parser");
const { createClient } = require("@supabase/supabase-js");
const { randomUUID } = require("crypto");

const jsonResponse = (statusCode, payload) => ({ statusCode, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: JSON.stringify(payload) });
function escapeHTML(text = "") { return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#039;"); }
function stripHTML(text = "") { return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim(); }
function slugify(text = "") { return text.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 80); }
function parseEnvFeeds(value = "") { return (value || "").split(",").map((entry) => entry.trim()).filter(Boolean); }
function normalizeTags(...tagSets) { const tags = new Set(); tagSets.forEach((set) => { if (!set) return; if (Array.isArray(set)) { set.forEach((tag) => tags.add(String(tag).toLowerCase().trim())); return; } if (typeof set === "string") set.split(",").map((tag) => tag.trim()).filter(Boolean).forEach((tag) => tags.add(tag.toLowerCase())); }); return Array.from(tags).filter(Boolean).slice(0, 8); }
function rewriteExcerpt(summary, title) { const base = stripHTML(summary || title || ""); if (!base) return ""; return `In brief: ${base.length > 200 ? `${base.slice(0, 200).trim()}...` : base}`; }
function buildContent(summary) { const cleaned = stripHTML(summary || ""); const sentences = cleaned.split(/[.!?]\s+/).map((s) => s.trim()).filter((s) => s.length > 30); const bullets = sentences.slice(0, 3); return `${cleaned ? `<p>${escapeHTML(cleaned)}</p>` : ""}${bullets.length ? `<ul>${bullets.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}</ul>` : ""}`; }
function getDomain(url = "") { try { return new URL(url).hostname.replace("www.", ""); } catch { return ""; } }
function extractRssImage(item) { const mediaContent = item["media:content"] || item["media:thumbnail"]; const mediaUrl = Array.isArray(mediaContent) ? mediaContent[0]?.$?.url || mediaContent[0]?.url : mediaContent?.$?.url || mediaContent?.url; if (mediaUrl) return mediaUrl; const enclosure = item.enclosure || (item.enclosures && item.enclosures[0]); return enclosure?.url && (enclosure.type || "").startsWith("image") ? enclosure.url : ""; }
async function fetchRssItems(source, parser) { if (!source.feed_url) return []; const feed = await parser.parseURL(source.feed_url); return (feed.items || []).map((item) => ({ title: item.title || "", link: item.link || "", published_at: item.isoDate || item.pubDate || new Date().toISOString(), summary: item.contentSnippet || item.summary || item.content || "", tags: item.categories || [], image_url: extractRssImage(item) })); }
async function fetchGdeltItems(source) { const query = source.query || source.feed_url || ""; if (!query) return []; const max = Number(source.max_items || 30); const response = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&format=json&maxrecords=${max}`); if (!response.ok) throw new Error(`GDELT fetch failed: ${response.status}`); const data = await response.json(); return (data.articles || []).map((article) => ({ title: article.title || "", link: article.url || "", published_at: article.seendate || article.datetime || new Date().toISOString(), summary: article.extras?.summary || article.excerpt || article.snippet || "", tags: article.themes || [], image_url: article.socialimage || "" })); }
function requireSuperForManualUser(user) { return user?.app_metadata?.role === "super"; }

exports.handler = async (event) => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return jsonResponse(500, { error: "Server misconfigured." });
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const headers = event.headers || {};
  const isScheduled = headers["x-nf-event"] === "schedule" || headers["X-Nf-Event"] === "schedule";
  if (!isScheduled) {
    const authHeader = headers.authorization || headers.Authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return jsonResponse(403, { error: "Missing auth token." });
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) return jsonResponse(403, { error: "Invalid auth token." });
    if (!requireSuperForManualUser(data.user)) return jsonResponse(403, { error: "Only super admins can run manually." });
  }

  const settingsResult = await supabase.from("curator_settings").select("*").maybeSingle();
  if (settingsResult.error) return jsonResponse(500, { error: settingsResult.error.message || "Unable to load curator settings." });
  const enabled = settingsResult.data?.enabled ?? true;
  if (!enabled) return jsonResponse(200, { ok: true, skipped: "disabled" });
  const perSource = Math.max(1, Number(settingsResult.data?.posts_per_source || 5));

  const sourcesResult = await supabase.from("curator_sources").select("*").eq("enabled", true);
  if (sourcesResult.error) return jsonResponse(500, { error: sourcesResult.error.message || "Unable to load curator sources." });
  const fetchedSources = sourcesResult.data || [];
  const envFeedUrls = parseEnvFeeds(process.env.NEWS_FEEDS);
  const envTipUrls = parseEnvFeeds(process.env.NEWS_TIPS_FEEDS);
  const knownUrls = new Set(fetchedSources.flatMap((source) => [source.feed_url, source.url]).filter(Boolean));
  const combinedEnv = [...envFeedUrls, ...envTipUrls];
  const fallbackSources = combinedEnv.filter((url) => !knownUrls.has(url)).map((url, index) => ({
    name: `Env source ${index + 1}`,
    source_type: "rss",
    url,
    feed_url: url,
    tags: [],
    enabled: true,
    is_active: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  }));

  const persistedFallbacks = [];
  for (const source of fallbackSources) {
    const upsert = await supabase
      .from("curator_sources")
      .upsert(source, { onConflict: "url" })
      .select("*")
      .single();
    if (upsert.error) {
      persistedFallbacks.push({ ...source, __error: upsert.error.message || "source_upsert_failed" });
    } else if (upsert.data) {
      persistedFallbacks.push(upsert.data);
    }
  }

  const finalSources = [...fetchedSources, ...persistedFallbacks.filter((source) => !source.__error && source.feed_url)];
  const setupErrors = persistedFallbacks.filter((source) => source.__error).map((source) => ({ source: source.name, error: source.__error }));
  if (!finalSources.length) return jsonResponse(200, { ok: true, skipped: "no_sources", feedErrors: setupErrors });

  const parser = new Parser({ timeout: 15000, customFields: { item: ["media:content", "media:thumbnail", "enclosure"] } });
  const posted = [];
  const feedErrors = [...setupErrors];
  for (const source of finalSources) {
    let items = [];
    try {
      items = source.source_type === "gdelt" ? await fetchGdeltItems(source) : await fetchRssItems(source, parser);
    } catch (error) {
      feedErrors.push({ source: source.name, error: error.message || "fetch_failed" });
      continue;
    }

    let insertedCount = 0;
    for (const item of items) {
      if (insertedCount >= perSource) break;
      if (!item.title || !item.link) continue;
      const title = item.title.trim();
      const slug = slugify(title);
      if (!slug) continue;
      const summary = stripHTML(item.summary || "");
      const payload = {
        id: randomUUID(),
        source_id: source.id,
        source_name: source.name,
        title,
        slug,
        excerpt: rewriteExcerpt(summary, title),
        description: rewriteExcerpt(summary, title),
        content: buildContent(summary),
        source_url: item.link,
        url: item.link,
        author: source.name,
        published_at: item.published_at || new Date().toISOString(),
        tags: normalizeTags(source.tags, item.tags),
        image_url: item.image_url || "",
        image_source_url: item.image_url || item.link,
        image_credit: source.image_credit || source.name || getDomain(item.link),
        status: "draft",
        is_posted: false
      };

      const existing = await supabase.from("curator_posts").select("id").eq("source_url", item.link).maybeSingle();
      if (existing.error) {
        feedErrors.push({ source: source.name, title, error: existing.error.message || "duplicate_check_failed" });
        continue;
      }
      if (existing.data?.id) continue;

      const insertResult = await supabase.from("curator_posts").insert(payload).select("id, title, source_url").single();
      if (insertResult.error) {
        feedErrors.push({ source: source.name, title, error: insertResult.error.message || "insert_failed" });
        continue;
      }
      insertedCount += 1;
      posted.push({ source: source.name, title });
    }

    await supabase
      .from("curator_sources")
      .update({ last_fetched_at: new Date().toISOString(), failure_count: 0, last_error: null })
      .eq("id", source.id);
  }

  return jsonResponse(200, { ok: true, posted, feedErrors });
};