import { supabase, getCurrentUser } from "./supabase.js";

export const DEFAULT_USER_PREFERENCES = {
  appearance: {
    reduceMotion: false,
    highContrast: false
  },
  notifications: {
    messages: true,
    replies: true,
    follows: true,
    mentions: true,
    announcements: true,
    marketplace: true
  },
  feed: {
    defaultFeed: "for-you",
    showRecommendations: true,
    rememberFilters: true
  },
  privacy: {
    allowMessages: true,
    allowRequests: true,
    showEmail: false
  },
  chat: {
    notifications: true,
    sounds: true,
    enterToSend: true,
    compact: false
  },
  groups: {
    showMemberTags: true
  },
  marketplace: {
    showLocation: true
  },
  discussion: {
    defaultSort: "trending",
    showLiveUpdates: true
  },
  novels: {
    fontSize: "medium",
    readerWidth: "comfortable",
    rememberPosition: true
  },
  videos: {
    autoplay: true,
    mutedByDefault: true,
    dataSaver: false
  },
  ai: {
    assistantContext: true
  }
};

function storageKey(userId) { return `timzee_user_preferences_v3:${userId || "guest"}`; }
function deepMerge(base, override) {
  const output = Array.isArray(base) ? [...base] : { ...base };
  if (!override || typeof override !== "object") return output;
  Object.entries(override).forEach(([key, value]) => {
    if (value && typeof value === "object" && !Array.isArray(value) && output[key] && typeof output[key] === "object") output[key] = deepMerge(output[key], value);
    else if (key in output) output[key] = value;
  });
  return output;
}
export function mergePreferences(value) { return deepMerge(DEFAULT_USER_PREFERENCES, value || {}); }
export function readLocalPreferences(userId = "guest") { try { return mergePreferences(JSON.parse(localStorage.getItem(storageKey(userId)) || "{}")); } catch (_) { return mergePreferences(); } }
export function writeLocalPreferences(userId, preferences) {
  const merged = mergePreferences(preferences);
  try { localStorage.setItem(storageKey(userId || "guest"), JSON.stringify(merged)); } catch (_) {}
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("timzee:preferences", { detail: merged }));
  return merged;
}
export async function loadUserPreferences(user = null) {
  const currentUser = user || (await getCurrentUser());
  if (!currentUser?.id) return readLocalPreferences("guest");
  const result = await supabase.from("user_settings").select("preferences").eq("user_id", currentUser.id).maybeSingle();
  if (result.error) return readLocalPreferences(currentUser.id);
  const merged = mergePreferences(result.data?.preferences || readLocalPreferences(currentUser.id));
  writeLocalPreferences(currentUser.id, merged); return merged;
}
export async function saveUserPreferences(userId, partial) {
  if (!userId) return writeLocalPreferences("guest", partial);
  const existing = readLocalPreferences(userId); const merged = mergePreferences(deepMerge(existing, partial));
  const result = await supabase.from("user_settings").upsert({ user_id: userId, preferences: merged, updated_at: new Date().toISOString() }, { onConflict: "user_id" });
  if (result.error) throw result.error;
  return writeLocalPreferences(userId, merged);
}
export function getPreference(path, fallback = undefined, userId = "guest") {
  const parts = String(path || "").split(".").filter(Boolean); let current = readLocalPreferences(userId);
  for (const part of parts) { if (current == null || typeof current !== "object" || !(part in current)) return fallback; current = current[part]; }
  return typeof current === "undefined" ? fallback : current;
}
