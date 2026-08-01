import { supabase } from "./supabase.js";
import { uploadMedia } from "./media.js";

// Fetches every currently-active (non-expired, visibility-permitted) story
// the current user is allowed to see, grouped by author. RLS already filters
// out expired/private-not-a-friend rows server-side; this just groups them.
export async function fetchStoriesFeed() {
  const result = await supabase
    .from("stories")
    .select("id, user_id, media_url, media_type, caption, visibility, created_at, expires_at")
    .order("created_at", { ascending: true });

  if (result.error) {
    console.warn("Failed to load stories:", result.error);
    return [];
  }

  const rows = result.data || [];
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  if (!userIds.length) return [];

  const profilesResult = await supabase
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", userIds);
  const profileMap = {};
  (profilesResult.data || []).forEach((profile) => {
    profileMap[profile.id] = profile;
  });

  const grouped = new Map();
  rows.forEach((row) => {
    if (!grouped.has(row.user_id)) {
      grouped.set(row.user_id, {
        userId: row.user_id,
        profile: profileMap[row.user_id] || null,
        stories: []
      });
    }
    grouped.get(row.user_id).stories.push(row);
  });

  return Array.from(grouped.values());
}

export async function fetchUserStories(userId) {
  const result = await supabase
    .from("stories")
    .select("id, user_id, media_url, media_type, caption, visibility, created_at, expires_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (result.error) {
    console.warn("Failed to load user stories:", result.error);
    return [];
  }
  return result.data || [];
}

export async function createStory({ userId, file, caption = "", visibility = "public" }) {
  if (!userId || !file) {
    return { error: { message: "A user and a media file are required." } };
  }
  const isVideo = file.type?.startsWith("video");
  let mediaUrl;
  try {
    mediaUrl = await uploadMedia(file, `stories/${userId}`);
  } catch (error) {
    return { error: { message: error.message || "Story upload failed." } };
  }
  if (!mediaUrl) {
    return { error: { message: "Story upload failed." } };
  }

  return supabase
    .from("stories")
    .insert({
      user_id: userId,
      media_url: mediaUrl,
      media_type: isVideo ? "video" : "image",
      caption: caption.trim() || null,
      visibility: visibility === "private" ? "private" : "public"
    })
    .select()
    .single();
}

export async function deleteStory(storyId) {
  return supabase.from("stories").delete().eq("id", storyId);
}
