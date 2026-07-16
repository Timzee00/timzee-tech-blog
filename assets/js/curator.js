/**
 * Curator / Scout Bot data layer
 *
 * IMPORTANT — schema note (read before editing):
 * This project accumulated two different, never-reconciled designs for
 * these tables. An older "Curator Bot" design (see
 * MODERATOR_AND_CURATOR_SCHEMA.sql) used curator_posts.url/description/
 * author/is_posted/post_id and curator_settings.auto_post/min_quality_score/
 * max_posts_per_day/duplicate_check/notify_admins. A newer "Scout" design
 * (see SUPABASE_SCHEMA.sql, netlify/functions/scout-news.js, and the
 * working Scout section in super/professional-panel.html) uses
 * curator_posts.source_url/excerpt/status and curator_settings.enabled/
 * posts_per_source. Only curator_sources (is_active/feed_url, added by
 * FIX_RLS_POLICIES.sql) was ever reconciled between the two — curator_posts
 * and the rest of curator_settings never were. This file previously matched
 * the OLDER design, which meant every read/write here targeted columns
 * that don't exist on the live curator_posts table (querying or inserting
 * a nonexistent column is a hard Postgres error, not a silent no-op) — the
 * actual cause of "the bot isn't working": the scheduled scout-news
 * function was fetching articles successfully, but this module could never
 * see them, and the "Add Source" form could never insert a new source at
 * all (description/category/api_key/headers/etc. aren't real columns).
 *
 * Every function below is now written against the confirmed live schema
 * (source_url/excerpt/status, enabled/posts_per_source), matching what
 * scout-news.js and the working Scout settings UI actually use.
 */

import { supabase } from "./supabase.js";

// ============================================================
// Helpers
// ============================================================

function pickFeedUrl(sourceData) {
  const url =
    sourceData?.feed_url ??
    sourceData?.url ??
    sourceData?.feedUrl ??
    sourceData?.link ??
    sourceData?.rss_url ??
    sourceData?.rssUrl ??
    "";
  return String(url).trim();
}

function cleanText(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s.length ? s : null;
}

function cleanStringArray(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => String(x ?? "").trim())
    .filter((x) => x.length > 0);
}

// ============================================================
// CURATOR SOURCES (RSS / GDELT feeds the bot monitors)
// Columns (live schema): id, name, source_type, feed_url, query, tags,
// image_credit, max_items, enabled, is_active (compat), created_at, updated_at
// ============================================================

export async function getAllCuratorSources() {
  const { data, error } = await supabase
    .from("curator_sources")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Error fetching curator sources:", error);
    throw error;
  }
  return data || [];
}

export async function getActiveCuratorSources() {
  const { data, error } = await supabase
    .from("curator_sources")
    .select("*")
    .or("is_active.eq.true,enabled.eq.true")
    .order("created_at", { ascending: true });

  if (error) {
    console.error("Error fetching active sources:", error);
    return [];
  }
  return data || [];
}

export async function createCuratorSource(sourceData) {
  try {
    const feedUrl = pickFeedUrl(sourceData);
    if (!feedUrl) {
      throw new Error("Feed URL is required. Paste a valid RSS feed URL.");
    }

    const isActive =
      typeof sourceData?.is_active === "boolean"
        ? sourceData.is_active
        : typeof sourceData?.enabled === "boolean"
          ? sourceData.enabled
          : true;

    const payload = {
      name: cleanText(sourceData?.name) || "Untitled Feed",
      feed_url: feedUrl,
      source_type: cleanText(sourceData?.source_type) || "rss",
      query: cleanText(sourceData?.query),
      tags: cleanStringArray(sourceData?.tags),
      image_credit: cleanText(sourceData?.image_credit) || cleanText(sourceData?.name),
      max_items: Number.isFinite(Number(sourceData?.max_items)) ? Number(sourceData.max_items) : 30,
      enabled: isActive,
      is_active: isActive
    };

    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    const { data, error } = await supabase
      .from("curator_sources")
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error creating curator source:", error);
    throw error;
  }
}

export async function updateCuratorSource(sourceId, sourceData) {
  try {
    const updatePayload = {
      name: cleanText(sourceData?.name) ?? undefined,
      query: cleanText(sourceData?.query) ?? undefined,
      image_credit: cleanText(sourceData?.image_credit) ?? undefined,
      tags: sourceData?.tags ? cleanStringArray(sourceData.tags) : undefined,
      max_items: Number.isFinite(Number(sourceData?.max_items)) ? Number(sourceData.max_items) : undefined
    };

    if (typeof sourceData?.is_active === "boolean") {
      updatePayload.is_active = sourceData.is_active;
      updatePayload.enabled = sourceData.is_active;
    }
    if (typeof sourceData?.enabled === "boolean") {
      updatePayload.enabled = sourceData.enabled;
      updatePayload.is_active = sourceData.enabled;
    }

    const feedUrl = pickFeedUrl(sourceData);
    if (feedUrl) {
      updatePayload.feed_url = feedUrl;
    }

    Object.keys(updatePayload).forEach((k) => updatePayload[k] === undefined && delete updatePayload[k]);

    const { data, error } = await supabase
      .from("curator_sources")
      .update(updatePayload)
      .eq("id", sourceId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error updating curator source:", error);
    throw error;
  }
}

export async function deleteCuratorSource(sourceId) {
  try {
    const { error } = await supabase
      .from("curator_sources")
      .delete()
      .eq("id", sourceId);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error("Error deleting curator source:", error);
    throw error;
  }
}

export async function toggleCuratorSourceStatus(sourceId, isActive) {
  try {
    const active = !!isActive;
    const { data, error } = await supabase
      .from("curator_sources")
      .update({ is_active: active, enabled: active })
      .eq("id", sourceId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error toggling source status:", error);
    throw error;
  }
}

// ============================================================
// CURATOR POSTS (articles scout-news.js fetches and stores)
// Columns (live schema): id, source_id, source_name, title, slug, excerpt,
// content, source_url, published_at, tags, image_url, image_source_url,
// image_credit, status ('draft' | 'posted'), created_at, updated_at
// ============================================================

export async function getAllCuratorPosts(limit = 50, offset = 0) {
  try {
    const { data, error } = await supabase
      .from("curator_posts")
      .select("*, curator_sources(name)")
      .order("published_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Error fetching curator posts:", error);
    return [];
  }
}

export async function getUnpostedCuratorPosts(limit = 20) {
  try {
    const { data, error } = await supabase
      .from("curator_posts")
      .select("*, curator_sources(name)")
      .neq("status", "posted")
      .order("published_at", { ascending: false })
      .limit(limit);

    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Error fetching unposted curator posts:", error);
    return [];
  }
}

export async function createCuratorPost(postData) {
  try {
    const sourceUrl = cleanText(postData?.source_url ?? postData?.url);
    if (!sourceUrl) throw new Error("Curator post source URL is required.");

    const payload = {
      source_id: postData?.source_id || null,
      source_name: cleanText(postData?.source_name),
      title: cleanText(postData?.title) || "Untitled",
      excerpt: cleanText(postData?.excerpt ?? postData?.description),
      content: cleanText(postData?.content),
      source_url: sourceUrl,
      published_at: postData?.published_at || null,
      image_url: cleanText(postData?.image_url),
      image_source_url: cleanText(postData?.image_source_url) || sourceUrl,
      image_credit: cleanText(postData?.image_credit),
      tags: cleanStringArray(postData?.tags),
      status: cleanText(postData?.status) || "draft"
    };

    const { data, error } = await supabase
      .from("curator_posts")
      .insert(payload)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error creating curator post:", error);
    throw error;
  }
}

export async function markCuratorPostAsPosted(curatorPostId) {
  try {
    const { data, error } = await supabase
      .from("curator_posts")
      .update({ status: "posted", updated_at: new Date().toISOString() })
      .eq("id", curatorPostId)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error marking curator post as posted:", error);
    throw error;
  }
}

export async function deleteCuratorPost(curatorPostId) {
  try {
    const { error } = await supabase
      .from("curator_posts")
      .delete()
      .eq("id", curatorPostId);

    if (error) throw error;
    return true;
  } catch (error) {
    console.error("Error deleting curator post:", error);
    throw error;
  }
}

// ============================================================
// CURATOR SETTINGS (bot configuration)
// Columns (live schema): id, enabled, posts_per_source, plus scout_enabled/
// scout_interval_minutes/scout_last_run_at/scout_last_status added by
// CURATOR_SCOUT_MERGE_MIGRATION.sql. `enabled` is the field scout-news.js
// actually reads to decide whether to run at all.
// ============================================================

export async function getCuratorSettings() {
  try {
    const { data, error } = await supabase
      .from("curator_settings")
      .select("*")
      .maybeSingle();

    if (error) throw error;
    return data || null;
  } catch (error) {
    console.error("Error fetching curator settings:", error);
    return null;
  }
}

export async function updateCuratorSettings(settingsData) {
  try {
    const existing = await getCuratorSettings();

    const basePayload = {
      enabled: settingsData?.enabled !== false,
      posts_per_source: Number.isFinite(Number(settingsData?.posts_per_source))
        ? Number(settingsData.posts_per_source)
        : 5,
      updated_at: new Date().toISOString()
    };

    if (existing?.id) {
      const { data, error } = await supabase
        .from("curator_settings")
        .update(basePayload)
        .eq("id", existing.id)
        .select()
        .single();

      if (error) throw error;
      return data;
    }

    const { data, error } = await supabase
      .from("curator_settings")
      .insert({
        id: crypto.randomUUID(),
        ...basePayload
      })
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error updating curator settings:", error);
    throw error;
  }
}

export async function getCuratorStats() {
  try {
    const { count: totalSources, error: e1 } = await supabase
      .from("curator_sources")
      .select("*", { count: "exact", head: true });
    if (e1) throw e1;

    const { count: activeSources, error: e2 } = await supabase
      .from("curator_sources")
      .select("*", { count: "exact", head: true })
      .or("is_active.eq.true,enabled.eq.true");
    if (e2) throw e2;

    const { count: totalPosts, error: e3 } = await supabase
      .from("curator_posts")
      .select("*", { count: "exact", head: true });
    if (e3) throw e3;

    const { count: unpostedPosts, error: e4 } = await supabase
      .from("curator_posts")
      .select("*", { count: "exact", head: true })
      .neq("status", "posted");
    if (e4) throw e4;

    return {
      totalSources: totalSources || 0,
      activeSources: activeSources || 0,
      totalPosts: totalPosts || 0,
      unpostedPosts: unpostedPosts || 0
    };
  } catch (error) {
    console.error("Error fetching curator stats:", error);
    return { totalSources: 0, activeSources: 0, totalPosts: 0, unpostedPosts: 0 };
  }
}

// ============================================================
// UTILITY FUNCTIONS
// ============================================================

export async function testCuratorSource(sourceUrl) {
  try {
    const url = String(sourceUrl || "").trim();
    if (!url) return false;

    const response = await fetch(url, {
      method: "HEAD",
      headers: { "User-Agent": "Timzee-Tech-Bot/1.0" }
    });

    return response.ok;
  } catch (error) {
    console.error("Error testing source:", error);
    return false;
  }
}

/**
 * Manually triggers the scheduled scout-news Netlify function (the same
 * bot netlify.toml runs hourly). Requires a signed-in super admin — the
 * function itself checks the role server-side, this just supplies the
 * session token. Mirrors the working pattern already used in
 * assets/js/super.js and super/professional-panel.html so there is now
 * one canonical implementation other UI can reuse instead of re-writing
 * this fetch call a third time.
 */
export async function triggerScoutSync() {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError) throw sessionError;

  const token = sessionData?.session?.access_token;
  if (!token) throw new Error("You must be signed in to run the bot.");

  const response = await fetch("/.netlify/functions/scout-news", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` }
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result?.error || `Scout bot failed (${response.status}).`);
  }
  return result;
}
