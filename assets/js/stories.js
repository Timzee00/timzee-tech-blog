import { supabase } from "./supabase.js";
import { uploadMedia } from "./media.js";

function ensureStoryCreationUI() {
  if (document.getElementById("timzeeStoriesStyles")) return;

  const stylesheet = document.createElement("link");
  stylesheet.id = "timzeeStoriesStyles";
  stylesheet.rel = "stylesheet";
  stylesheet.href = "assets/css/stories.css";
  document.head.appendChild(stylesheet);

  const rail = document.getElementById("storiesRail");
  const addStoryBtn = document.getElementById("addStoryBtn");
  if (!rail || !addStoryBtn) return;

  const action = document.createElement("button");
  action.type = "button";
  action.id = "createStatusAction";
  action.className = "story-create-action";
  action.setAttribute("aria-label", "Create a new status");
  action.innerHTML = `
    <span class="story-create-action-icon" aria-hidden="true">+</span>
    <span>
      <strong>Create status</strong>
      <small>Photo or video · 24 hours</small>
    </span>
  `;

  action.addEventListener("click", () => addStoryBtn.click());
  rail.parentElement?.insertBefore(action, rail);

  const style = document.createElement("style");
  style.textContent = `
    .story-create-action {
      width: 100%;
      display: flex;
      align-items: center;
      gap: 14px;
      margin: 18px 0 4px;
      padding: 14px 16px;
      border: 1px solid var(--color-border, rgba(15,23,42,.14));
      border-radius: 16px;
      background: var(--color-surface, #fff);
      color: var(--color-text, #0f172a);
      text-align: left;
      cursor: pointer;
      box-shadow: 0 6px 20px rgba(15,23,42,.06);
    }
    .story-create-action:hover { transform: translateY(-1px); }
    .story-create-action-icon {
      width: 42px;
      height: 42px;
      flex: 0 0 42px;
      display: grid;
      place-items: center;
      border-radius: 50%;
      background: var(--color-primary, #0f766e);
      color: #fff;
      font-size: 24px;
      font-weight: 700;
    }
    .story-create-action strong,
    .story-create-action small { display: block; }
    .story-create-action small {
      margin-top: 2px;
      color: var(--color-text-muted, #64748b);
      font-size: .78rem;
    }
    @media (max-width: 600px) {
      .story-create-action { margin-top: 12px; }
    }
  `;
  document.head.appendChild(style);
}

ensureStoryCreationUI();

// Fetches every currently-active (non-expired, visibility-permitted) story
// the current user is allowed to see, grouped by author. RLS already filters
// out expired/private-not-a-friend rows server-side; this just groups them.
export async function fetchStoriesFeed() {
  const result = await supabase
    .from("stories")
    .select("id, user_id, media_url, media_type, caption, visibility, created_at, expires_at")
    .order("created_at", { ascending: true });

  if (result.error) {
    console.error("Failed to load stories:", result.error);
    throw result.error;
  }

  const rows = result.data || [];
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  if (!userIds.length) return [];

  const profilesResult = await supabase
    .from("public_profiles")
    .select("id, display_name, avatar_url")
    .in("id", userIds);
  if (profilesResult.error) {
    console.error("Failed to load story profiles:", profilesResult.error);
    throw profilesResult.error;
  }

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
