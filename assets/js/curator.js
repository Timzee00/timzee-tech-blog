/**
 * Curator Bot Management System
 * Manages RSS sources, fetched posts, and bot configuration
 */

import { supabase } from "./supabase.js";

// ============================================================
// CURATOR SOURCES (RSS Feeds Management)
// ============================================================

export async function getAllCuratorSources() {
  try {
    const { data, error } = await supabase
      .from("curator_sources")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Error fetching curator sources:", error);
    throw error;
  }
}

export async function getActiveCuratorSources() {
  try {
    const { data, error } = await supabase
      .from("curator_sources")
      .select("*")
      .eq("is_active", true)
      .order("last_fetched_at", { ascending: true });
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error("Error fetching active sources:", error);
    return [];
  }
}

export async function createCuratorSource(sourceData) {
  try {
    // Insert both 'url' and 'feed_url' to be compatible with mixed column names
    const payload = {
      name: sourceData.name,
      url: sourceData.url,
      feed_url: sourceData.url,
      source_type: sourceData.source_type || "rss",
      description: sourceData.description,
      category: sourceData.category,
      api_key: sourceData.api_key,
      headers: sourceData.headers || {},
      filter_keywords: sourceData.filter_keywords || [],
      exclude_keywords: sourceData.exclude_keywords || []
    };

    if (typeof sourceData.is_active !== "undefined") {
      payload.is_active = sourceData.is_active;
      payload.enabled = sourceData.is_active; // support both column names
    }
    if (sourceData.created_by) payload.created_by = sourceData.created_by;
    if (sourceData.created_at) payload.created_at = sourceData.created_at;
    if (sourceData.fetch_frequency_minutes) payload.fetch_frequency_minutes = sourceData.fetch_frequency_minutes;

    const { data, error } = await supabase
      .from("curator_sources")
      .insert(payload);
    if (error) throw error;
    return data;
  } catch (error) {
    console.error("Error creating curator source:", error);
    throw error;
  }
}

export async function updateCuratorSource(sourceId, sourceData) {
  try {
    const { data, error } = await supabase
      .from("curator_sources")
      .update({
        name: sourceData.name,
        description: sourceData.description,
        category: sourceData.category,
        is_active: sourceData.is_active,
        fetch_frequency_minutes: sourceData.fetch_frequency_minutes,
        api_key: sourceData.api_key,
        filter_keywords: sourceData.filter_keywords,
        exclude_keywords: sourceData.exclude_keywords
      })
      .eq("id", sourceId);
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
    const updatePayload = { is_active: isActive, enabled: isActive };
    const { data, error } = await supabase
      .from("curator_sources")
      .update(updatePayload)
      .eq("id", sourceId);
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
    const { data, error } = await supabase
      .from("curator_posts")
      .insert({
        source_id: postData.source_id,
        title: postData.title,
        description: postData.description,
        content: postData.content,
        url: postData.url,
        author: postData.author,
        published_at: postData.published_at,
        image_url: postData.image_url,
        tags: postData.tags || []
      });
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
      .update({ is_posted: true, post_id: postId })
      .eq("id", curatorPostId);
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
    if (error && error.code !== "PGRST116") throw error; // PGRST116 = no rows
    return data || null;
  } catch (error) {
    console.error("Error fetching curator settings:", error);
    return null;
  }
}

export async function updateCuratorSettings(settingsData) {
  try {
    // Get existing settings first
    const existing = await getCuratorSettings();

    if (existing) {
      // Update existing
      const { data, error } = await supabase
        .from("curator_settings")
        .update({
          auto_post: settingsData.auto_post,
          auto_post_hour: settingsData.auto_post_hour,
          min_quality_score: settingsData.min_quality_score,
          duplicate_check: settingsData.duplicate_check,
          notify_admins: settingsData.notify_admins,
          max_posts_per_day: settingsData.max_posts_per_day,
          updated_at: new Date().toISOString()
        })
        .eq("id", existing.id);
      if (error) throw error;
      return data;
    } else {
      // Create new
      const { data, error } = await supabase
        .from("curator_settings")
        .insert({
          api_key: crypto.randomUUID(),
          auto_post: settingsData.auto_post || false,
          auto_post_hour: settingsData.auto_post_hour || 9,
          min_quality_score: settingsData.min_quality_score || 60,
          duplicate_check: settingsData.duplicate_check !== false,
          notify_admins: settingsData.notify_admins !== false,
          max_posts_per_day: settingsData.max_posts_per_day || 5
        });
      if (error) throw error;
      return data;
    }
  } catch (error) {
    console.error("Error updating curator settings:", error);
    throw error;
  }
}

export async function getCuratorStats() {
  try {
    const { count: totalSources } = await supabase
      .from("curator_sources")
      .select("*", { count: "exact", head: true });

    const { count: activeSources } = await supabase
      .from("curator_sources")
      .select("*", { count: "exact", head: true })
      .eq("is_active", true);

    const { count: totalPosts } = await supabase
      .from("curator_posts")
      .select("*", { count: "exact", head: true });

    const { count: unpostedPosts } = await supabase
      .from("curator_posts")
      .select("*", { count: "exact", head: true })
      .eq("is_posted", false);

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
    // This would be called by the bot or admin to test connectivity
    const response = await fetch(sourceUrl, {
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
  // This would trigger the bot to fetch from this specific source
  // Typically called as a serverless function
  console.log("Triggering import for source:", sourceId);
  // Implementation would call a Netlify function or external service
}
