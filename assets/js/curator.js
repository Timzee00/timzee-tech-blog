/**
 * Curator Bot Management System (Stable Version)
 * - Works with Supabase table: public.curator_sources / curator_posts / curator_settings
 * - Prevents url being null (fixes NOT NULL errors)
 * - Keeps compatibility with "url" + "feed_url" and "is_active" + "enabled"
 */

import { supabase } from "./supabase.js";

// ============================================================
// Helpers
// ============================================================

function pickUrl(sourceData) {
  const url =
    sourceData?.url ??
    sourceData?.feed_url ??
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

function cleanHeaders(headers) {
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) return {};
  return headers;
}

// ============================================================
// CURATOR SOURCES (RSS Feeds Management)
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
  // Support both is_active and enabled (some schemas use one)
  const { data, error } = await supabase
    .from("curator_sources")
    .select("*")
    .or("is_active.eq.true,enabled.eq.true")
    .order("last_fetched_at", { ascending: true });

  if (error) {
    console.error("Error fetching active sources:", error);
    return [];
  }
  return data || [];
}

export async function createCuratorSource(sourceData) {
  try {
    const url = pickUrl(sourceData);
    if (!url) {
      throw new Error("Feed URL is required. Paste a valid RSS feed URL.");
    }

    // Prefer explicit active state, else default true
    const isActive =
      typeof sourceData?.is_active === "boolean"
        ? sourceData.is_active
        : typeof sourceData?.enabled === "boolean"
          ? sourceData.enabled
          : true;

    const payload = {
      name: cleanText(sourceData?.name) || "Untitled Feed",
      url,              // NOT NULL
      feed_url: url,    // keep both
      source_type: cleanText(sourceData?.source_type) || "rss",
      description: cleanText(sourceData?.description),
      category: cleanText(sourceData?.category),
      category_id: sourceData?.category_id || null,
      api_key: cleanText(sourceData?.api_key),
      headers: cleanHeaders(sourceData?.headers),
      filter_keywords: cleanStringArray(sourceData?.filter_keywords),
      exclude_keywords: cleanStringArray(sourceData?.exclude_keywords),
      is_active: isActive,
      enabled: isActive,
      fetch_frequency_minutes:
        Number.isFinite(Number(sourceData?.fetch_frequency_minutes))
          ? Number(sourceData.fetch_frequency_minutes)
          : undefined,
      created_by: sourceData?.created_by || undefined,
      created_at: sourceData?.created_at || undefined
    };

    // remove undefined fields so Supabase doesn't complain
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
      description: cleanText(sourceData?.description) ?? undefined,
      category: cleanText(sourceData?.category) ?? undefined,
      category_id: sourceData?.category_id ?? undefined,
      api_key: cleanText(sourceData?.api_key) ?? undefined,
      filter_keywords: sourceData?.filter_keywords ? cleanStringArray(sourceData.filter_keywords) : undefined,
      exclude_keywords: sourceData?.exclude_keywords ? cleanStringArray(sourceData.exclude_keywords) : undefined,
      headers: sourceData?.headers ? cleanHeaders(sourceData.headers) : undefined,
      fetch_frequency_minutes:
        Number.isFinite(Number(sourceData?.fetch_frequency_minutes))
          ? Number(sourceData.fetch_frequency_minutes)
          : undefined
    };

    // handle status toggles
    if (typeof sourceData?.is_active === "boolean") {
      updatePayload.is_active = sourceData.is_active;
      updatePayload.enabled = sourceData.is_active;
    }
    if (typeof sourceData?.enabled === "boolean") {
      updatePayload.enabled = sourceData.enabled;
      updatePayload.is_active = sourceData.enabled;
    }

    // allow updating URL safely
    const url = pickUrl(sourceData);
    if (url) {
      updatePayload.url = url;
      updatePayload.feed_url = url;
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
// CURATOR POSTS (Fetched Articles)
// ============================================================

export async function getAllCuratorPosts(limit = 50, offset = 0) {
  try {
    const { data, error } = await supabase
      .from("curator_posts")
      .select("*, curator_sources(name, category)")
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
      .select("*, curator_sources(name, category)")
      .eq("is_posted", false)
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
    const url = cleanText(postData?.url);
    if (!url) throw new Error("Curator post URL is required.");

    const payload = {
      source_id: postData?.source_id || null,
      title: cleanText(postData?.title) || "Untitled",
      description: cleanText(postData?.description),
      content: cleanText(postData?.content),
      url,
      author: cleanText(postData?.author),
      published_at: postData?.published_at || null,
      image_url: cleanText(postData?.image_url),
      tags: cleanStringArray(postData?.tags)
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

export async function markCuratorPostAsPosted(curatorPostId, postId) {
  try {
    const { data, error } = await supabase
      .from("curator_posts")
      .update({ is_posted: true, post_id: postId || null })
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
// CURATOR SETTINGS (Bot Configuration)
// ============================================================

export async function getCuratorSettings() {
  try {
    const { data, error } = await supabase
      .from("curator_settings")
      .select("*")
      .single();

    // PGRST116 = No rows found
    if (error && error.code !== "PGRST116") throw error;
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
      auto_post: !!settingsData?.auto_post,
      auto_post_hour: Number.isFinite(Number(settingsData?.auto_post_hour)) ? Number(settingsData.auto_post_hour) : 9,
      min_quality_score: Number.isFinite(Number(settingsData?.min_quality_score)) ? Number(settingsData.min_quality_score) : 60,
      duplicate_check: settingsData?.duplicate_check !== false,
      notify_admins: settingsData?.notify_admins !== false,
      max_posts_per_day: Number.isFinite(Number(settingsData?.max_posts_per_day)) ? Number(settingsData.max_posts_per_day) : 5,
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

    // Create first row if none exists
    const { data, error } = await supabase
      .from("curator_settings")
      .insert({
        api_key: crypto.randomUUID(),
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
      .eq("is_posted", false);

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

export async function testCuratorSource(sourceUrl, sourceType = "rss") {
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

export async function importCuratorPostsFromSource(sourceId) {
  // Placeholder: typically a server-side function should do fetching/parsing.
  console.log("Triggering import for source:", sourceId);
}
