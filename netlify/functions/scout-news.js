const Parser = require("rss-parser");
const { createClient } = require("@supabase/supabase-js");
const { randomUUID } = require("crypto");

const jsonResponse = (statusCode, payload) => ({
  statusCode,
  headers: {
    "Content-Type": "application/json"
  },
  body: JSON.stringify(payload)
});

function escapeHTML(text = "") {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function stripHTML(text = "") {
  return text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function slugify(text = "") {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

function parseEnvFeeds(value = "") {
  return (value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function normalizeTags(...tagSets) {
  const tags = new Set();
  tagSets.forEach((set) => {
    if (!set) return;
    if (Array.isArray(set)) {
      set.forEach((tag) => tags.add(String(tag).toLowerCase().trim()));
      return;
    }
    if (typeof set === "string") {
      set
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .forEach((tag) => tags.add(tag.toLowerCase()));
    }
  });
  return Array.from(tags).filter(Boolean).slice(0, 8);
}

function rewriteExcerpt(summary, title) {
  const base = stripHTML(summary || title || "");
  if (!base) return "";
  const trimmed = base.length > 200 ? `${base.slice(0, 200).trim()}...` : base;
  return `In brief: ${trimmed}`;
}

function buildContent(summary) {
  const cleaned = stripHTML(summary || "");
  const sentences = cleaned
    .split(/[.!?]\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 30);
  const bullets = sentences.slice(0, 3);
  const body = cleaned ? `<p>${escapeHTML(cleaned)}</p>` : "";
  const bulletHtml = bullets.length
    ? `<ul>${bullets.map((item) => `<li>${escapeHTML(item)}</li>`).join("")}</ul>`
    : "";
  return `${body}${bulletHtml}`;
}

function getDomain(url = "") {
  try {
    return new URL(url).hostname.replace("www.", "");
  } catch (error) {
    return "";
  }
}

function extractRssImage(item) {
  const mediaContent = item["media:content"] || item["media:thumbnail"];
  const mediaUrl = Array.isArray(mediaContent)
    ? mediaContent[0]?.$?.url || mediaContent[0]?.url
    : mediaContent?.$?.url || mediaContent?.url;
  if (mediaUrl) return mediaUrl;

  const enclosure = item.enclosure || (item.enclosures && item.enclosures[0]);
  if (enclosure?.url && (enclosure.type || "").startsWith("image")) {
    return enclosure.url;
  }
  return "";
}

async function fetchRssItems(source, parser) {
  if (!source.feed_url) return [];
  const feed = await parser.parseURL(source.feed_url);
  return (feed.items || []).map((item) => ({
    title: item.title || "",
    link: item.link || "",
    published_at: item.isoDate || item.pubDate || new Date().toISOString(),
    summary: item.contentSnippet || item.summary || item.content || "",
    tags: item.categories || [],
    image_url: extractRssImage(item)
  }));
}

async function fetchGdeltItems(source) {
  const query = source.query || source.feed_url || "";
  if (!query) return [];
  const max = Number(source.max_items || 30);
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(
    query
  )}&mode=ArtList&format=json&maxrecords=${max}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`GDELT fetch failed: ${response.status}`);
  }
  const data = await response.json();
  const articles = data.articles || [];
  return articles.map((article) => ({
    title: article.title || "",
    link: article.url || "",
    published_at: article.seendate || article.datetime || new Date().toISOString(),
    summary: article.extras?.summary || article.excerpt || article.snippet || "",
    tags: article.themes || [],
    image_url: article.socialimage || ""
  }));
}

async function requireSuperForManual(supabase, token) {
  if (!token) return { error: "Missing auth token." };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { error: "Invalid auth token." };
  let role = data.user.user_metadata?.role;
  if (!role) {
    const profileResult = await supabase
      .from("profiles")
      .select("role")
      .eq("id", data.user.id)
      .maybeSingle();
    if (profileResult.data?.role) {
      role = profileResult.data.role;
    }
  }
  if (role !== "super") return { error: "Only super admins can run manually." };
  return { user: data.user };
}

exports.handler = async (event) => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return jsonResponse(500, { error: "Server misconfigured." });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const isScheduled = event.headers["x-nf-event"] === "schedule";
  if (!isScheduled) {
    const authHeader = event.headers.authorization || event.headers.Authorization || "";
    const token = authHeader.replace("Bearer ", "");
    const guard = await requireSuperForManual(supabase, token);
    if (guard.error) return jsonResponse(403, { error: guard.error });
  }

  const settings = await supabase.from("curator_settings").select("*").maybeSingle();
  const enabled = settings.data?.enabled ?? true;
  if (!enabled) {
    return jsonResponse(200, { ok: true, skipped: "disabled" });
  }
  const perSource = settings.data?.posts_per_source || 5;

  const sourcesResult = await supabase
    .from("curator_sources")
    .select("*")
    .eq("enabled", true);
  const fetchedSources = sourcesResult.data || [];
  const envFeedUrls = parseEnvFeeds(process.env.NEWS_FEEDS);
  const envTipUrls = parseEnvFeeds(process.env.NEWS_TIPS_FEEDS);
  const knownUrls = new Set(fetchedSources.map((source) => source.feed_url).filter(Boolean));
  const combinedEnv = [...envFeedUrls, ...envTipUrls];
  const fallbackSources = combinedEnv
    .filter((url) => url && !knownUrls.has(url))
    .map((url, index) => ({
      id: randomUUID(),
      name: `Env source ${index + 1}`,
      source_type: "rss",
      feed_url: url,
      tags: [],
      enabled: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }));
  const finalSources = fallbackSources.length ? [...fetchedSources, ...fallbackSources] : fetchedSources;
  if (!finalSources.length) {
    return jsonResponse(200, { ok: true, skipped: "no_sources" });
  }

  const parser = new Parser({
    timeout: 15000,
    customFields: {
      item: ["media:content", "media:thumbnail", "enclosure"]
    }
  });

  const posted = [];
  const feedErrors = [];

  for (const source of finalSources) {
    let items = [];
    try {
      if (source.source_type === "gdelt") {
        items = await fetchGdeltItems(source);
      } else {
        items = await fetchRssItems(source, parser);
      }
    } catch (error) {
      feedErrors.push({ source: source.name, error: error.message || "fetch_failed" });
      continue;
    }

    let insertedCount = 0;
    for (const item of items) {
      if (!item.title || !item.link) continue;
      const title = item.title.trim();
      const slug = slugify(title);
      if (!slug) continue;

      const summary = stripHTML(item.summary || "");
      const excerpt = rewriteExcerpt(summary, title);
      const content = buildContent(summary);
      const tags = normalizeTags(source.tags, item.tags);
      const imageUrl = item.image_url || "";
      const imageCredit = source.image_credit || source.name || getDomain(item.link);

      const payload = {
        id: randomUUID(),
        source_id: source.id,
        source_name: source.name,
        title,
        slug,
        excerpt,
        content,
        source_url: item.link,
        published_at: item.published_at || new Date().toISOString(),
        tags,
        image_url: imageUrl,
        image_source_url: item.link,
        image_credit: imageCredit,
        status: "draft",
        created_at: new Date().toISOString()
      };

      const result = await supabase
        .from("curator_posts")
        .upsert(payload, { onConflict: "source_url", ignoreDuplicates: true })
        .select("id");

      if (!result.error && result.data && result.data.length) {
        posted.push(payload.source_url);
        insertedCount += 1;
      }

      if (insertedCount >= perSource) break;
    }
  }

  return jsonResponse(200, { ok: true, posted, feedErrors });
};
