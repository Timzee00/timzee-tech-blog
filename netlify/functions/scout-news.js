const Parser = require("rss-parser");
const { createClient } = require("@supabase/supabase-js");
const { requireRole } = require("./_lib/auth-role.js");
const { randomUUID } = require("crypto");
const { isScheduledInvocation } = require("./_lib/scheduled-event.cjs");
const { clampScoutItems, scheduleScoutSources, classifyScoutSource, normalizeScoutDate, normalizeScoutArticleUrl, SCOUT_LIMITS } = require("./_lib/scout-budget.cjs");

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
async function fetchGdeltItems(source) {
  const query = String(source.query || source.feed_url || "").trim().slice(0, 240);
  if (!query) return [];
  const max = Math.max(1, Math.min(30, Math.trunc(Number(source.max_items) || 30)));
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=ArtList&format=json&maxrecords=${max}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!response.ok) throw new Error(`GDELT fetch failed: ${response.status}`);
  const data = await response.json();
  return (data.articles || []).map((article) => ({
    title: article.title || "", link: article.url || "",
    published_at: article.seendate || article.datetime || new Date().toISOString(),
    summary: article.extras?.summary || article.excerpt || article.snippet || "",
    tags: article.themes || [], image_url: article.socialimage || ""
  }));
}

exports.handler = async (event) => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) return jsonResponse(500, { error: "Server misconfigured." });
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const headers = event.headers || {};
  const isScheduled = isScheduledInvocation(event);
  if (!isScheduled) {
    const authHeader = headers.authorization || headers.Authorization || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return jsonResponse(403, { error: "Missing auth token." });
    const guard = await requireRole(supabase, token, ["super"], "Only super admins can run manually.");
    if (guard.error) return jsonResponse(403, { error: guard.error });
  }

  const settingsResult = await supabase.from("curator_settings").select("*").maybeSingle();
  if (settingsResult.error) return jsonResponse(500, { error: settingsResult.error.message || "Unable to load curator settings." });
  const enabled = settingsResult.data?.enabled === true &&
    settingsResult.data?.scout_enabled !== false;
  if (!enabled) return jsonResponse(200, { ok: true, skipped: "disabled" });
  const perSource = clampScoutItems(settingsResult.data?.posts_per_source || 5);

  const sourcesResult = await supabase.from("curator_sources").select("*").eq("enabled", true)
    .order("last_fetched_at", { ascending: true, nullsFirst: true }).limit(12);
  if (sourcesResult.error) return jsonResponse(500, { error: sourcesResult.error.message || "Unable to load curator sources." });
  const fetchedSources = sourcesResult.data || [];
  const envFeedUrls = parseEnvFeeds(process.env.NEWS_FEEDS);
  const envTipUrls = parseEnvFeeds(process.env.NEWS_TIPS_FEEDS);
  const knownUrls = new Set(fetchedSources.flatMap((source) => [source.feed_url, source.url]).filter(Boolean));
  const combinedEnv = [...new Set([...envFeedUrls, ...envTipUrls])].slice(0, 12);
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

  const finalSources = scheduleScoutSources([...fetchedSources, ...persistedFallbacks.filter((source) => !source.__error && source.feed_url)]);
  const setupErrors = persistedFallbacks.filter((source) => source.__error).map((source) => ({ source: source.name, error: source.__error }));
  if (!finalSources.length) return jsonResponse(200, { ok: true, skipped: "no_sources", feedErrors: setupErrors });

  const parser = new Parser({ timeout: 6000, customFields: { item: ["media:content", "media:thumbnail", "enclosure"] } });
  const posted = [];
  const feedErrors = [...setupErrors];
  let sourcesFetched = 0;
  let sourcesFailed = 0;
  const sourceOutcomes = [];
  const startedAt = new Date().toISOString();
  const deadline = Date.now() + 18000;
  for (const source of finalSources) {
    if (Date.now() >= deadline) {
      feedErrors.push({ source: source.name, error: "Deferred to the next scheduled run (time budget)" });
      break;
    }
    let items = [];
    try {
      items = source.source_type === "gdelt" ? await fetchGdeltItems(source) : await fetchRssItems(source, parser);
      sourcesFetched += 1;
    } catch (error) {
      const message = String(error.message || "fetch_failed").slice(0, 300);
      feedErrors.push({ source: source.name, error: message });
      sourcesFailed++;
      sourceOutcomes.push({ source: source.name, status: "failed", error: message });
      await supabase.from("curator_sources").update({
        last_fetched_at: new Date().toISOString(),
        failure_count: Math.max(0, Number(source.failure_count || 0)) + 1,
        last_error: message
      }).eq("id", source.id);
      continue;
    }

    let insertedCount = 0;
    let duplicates = 0;
    let unusableArticles = 0;
    let inspectedArticles = 0;
    const insertErrors = [];
    for (const item of items.slice(0, SCOUT_LIMITS.MAX_ARTICLES_INSPECTED)) {
      if (Date.now() >= deadline) break;
      inspectedArticles++;
      if (insertedCount >= perSource) break;
      if (!item.title || !item.link) { unusableArticles++; continue; }
      const articleUrl = normalizeScoutArticleUrl(item.link);
      if (!articleUrl) { unusableArticles++; continue; }
      const title = String(item.title).trim();
      const slug = slugify(title);
      if (!slug) { unusableArticles++; continue; }
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
        source_url: articleUrl,
        url: articleUrl,
        author: source.name,
        published_at: normalizeScoutDate(item.published_at),
        tags: normalizeTags(source.tags, item.tags),
        image_url: item.image_url || "",
        image_source_url: item.image_url || item.link,
        image_credit: source.image_credit || source.name || getDomain(item.link),
        status: "draft",
        is_posted: false
      };

      // Unique DB constraints on url/source_url are authoritative. Avoid a
      // SELECT-before-INSERT round-trip and its concurrency race on every item.
      const insertResult = await supabase.from("curator_posts")
        .insert(payload).select("id").single();
      if (insertResult.error) {
        // A second scout may have already inserted this external article.
        if (insertResult.error.code === "23505") { duplicates++; continue; }
        const issue = String(insertResult.error.message || "insert_failed").slice(0, 300);
        feedErrors.push({ source: source.name, title, error: issue });
        insertErrors.push(issue);
        continue;
      }
      insertedCount += 1;
      posted.push({ source: source.name, title });
    }

    const outcome = classifyScoutSource({
      fetched: true, inserts: insertedCount, duplicates, errors: insertErrors
    });
    sourceOutcomes.push({
      source: source.name, status: outcome, fetched_items: items.length,
      inspected_items: inspectedArticles, unusable_items: unusableArticles,
      imported: insertedCount, duplicates,
      ...(insertErrors.length ? { error: insertErrors[0] } : {})
    });
    if (outcome === "failed") sourcesFailed++;
    const issue = insertErrors.length ? insertErrors[0] : null;
    const sourceUpdate = await supabase.from("curator_sources").update({
      last_fetched_at: new Date().toISOString(),
      failure_count: issue ? Math.max(0, Number(source.failure_count || 0)) + 1 : 0,
      last_error: issue
    }).eq("id", source.id);
    if (sourceUpdate.error) feedErrors.push({
      source: source.name, error: "Could not update source health: " + sourceUpdate.error.message
    });
  }

  // Service-role-only operational status, never exposed in public responses.
  // Preserve the existing five-minute publication automation separately.
  const finishedAt = new Date().toISOString();
  const failed = finalSources.length > 0 && sourcesFailed === finalSources.length && posted.length === 0;
  const status = failed ? "failed" : feedErrors.length ? "partial" : posted.length ? "success" : "no_new_articles";
  const statusWrite = await supabase.from("system_job_status").upsert({
    job_name: "curator-scout",
    last_started_at: startedAt,
    ...(failed ? {last_failed_at:finishedAt} : {last_succeeded_at:finishedAt}),
    last_result: { reviewed_drafts_created: posted.length, sources_checked: finalSources.length, sources_fetched: sourcesFetched,
      source_errors: feedErrors.length, source_outcomes: sourceOutcomes, status, max_sources_per_run: SCOUT_LIMITS.MAX_SOURCES },
    last_error: failed ? "All checked feeds failed." : feedErrors.length ? "Some sources failed; inspect feed errors." : null,
    updated_at: finishedAt
  }, { onConflict: "job_name" });
  if (statusWrite.error) console.warn("Curator scout status update failed:", statusWrite.error.message);
  const legacyStatus = await supabase.from("curator_settings").update({
    scout_last_run_at: finishedAt, scout_last_status: status
  }).eq("id",settingsResult.data?.id);
  if (legacyStatus.error) console.warn("Curator settings status update failed:",legacyStatus.error.message);
  if (failed) {
    console.error("All curator feeds failed:", feedErrors.map(entry=>({source:entry.source,error:entry.error})));
    return jsonResponse(502,{ok:false,error:"All checked news sources failed. Review source errors and try again.",feedErrors,sourceOutcomes,sourcesChecked:finalSources.length});
  }
  return jsonResponse(200,{ok:true,status,posted,feedErrors,sourceOutcomes,sourcesChecked:finalSources.length});
};