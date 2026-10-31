import { supabase, getCurrentUser } from "./supabase.js";

export const DEFAULT_USER_PREFERENCES = {
  appearance: {
    reduceMotion: false,
    highContrast: false,
    theme: "system",
    fontScale: "100",
    contentDensity: "comfortable"
  },
  notifications: {
    messages: true,
    replies: true,
    follows: true,
    mentions: true,
    announcements: true,
    marketplace: true,
    profileViews: true,
    operationsDigest: true
  },
  feed: {
    defaultFeed: "for-you",
    showRecommendations: true,
    rememberFilters: true,
    weeklyReadingGoal: 0
  },
  privacy: {
    allowMessages: true,
    allowRequests: true,
    showEmail: false,
    recordProfileVisits: true,
    shareProfileVisits: false,
    rememberReading: true
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
    defaultSort: "active",
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
  performance: {
    dataSaver: false
  },
  ai: {
    assistantContext: true
  }
};

function storageKey(userId) { return `timzee_user_preferences_v3:${userId || "guest"}`; }
/* Persist only the supported shape: storage and database JSON are untrusted
   inputs, and should not be able to replace booleans with objects or overwrite
   inherited Object properties such as __proto__ and constructor. */
const PREFERENCE_ENUMS = {
  "appearance.theme": ["system", "light", "dark"],
  "appearance.fontScale": ["90", "100", "110", "125"],
  "appearance.contentDensity": ["comfortable", "compact"],
  "feed.defaultFeed": ["for-you", "following"],
  "discussion.defaultSort": ["active", "new", "top", "unanswered"],
  "novels.fontSize": ["small", "medium", "large", "xlarge"],
  "novels.readerWidth": ["compact", "comfortable", "wide"]
};
function deepMerge(base, override, parentPath = "") {
  const output = { ...base };
  if (!override || typeof override !== "object" || Array.isArray(override)) return output;
  for (const [key, value] of Object.entries(override)) {
    if (!Object.prototype.hasOwnProperty.call(base, key)) continue;
    const expected = base[key];
    const path = parentPath ? parentPath + "." + key : key;
    if (expected && typeof expected === "object" && !Array.isArray(expected)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        output[key] = deepMerge(expected, value, path);
      }
      continue;
    }
    if (typeof value !== typeof expected || value === null) continue;
    if (typeof value === "number" && !Number.isFinite(value)) continue;
    if (path === "feed.weeklyReadingGoal" && ![0,2,4,7].includes(value)) continue;
    if (typeof value === "string" && (value.length > 80 ||
      (PREFERENCE_ENUMS[path] && !PREFERENCE_ENUMS[path].includes(value)))) continue;
    if (typeof value === "string" || typeof value === "boolean" || typeof value === "number") {
      output[key] = value;
    }
  }
  return output;
}
export function mergePreferences(value) { return deepMerge(DEFAULT_USER_PREFERENCES, value || {}); }
export function readLocalPreferences(userId = "guest") { try { return mergePreferences(JSON.parse(localStorage.getItem(storageKey(userId)) || "{}")); } catch (_) { return mergePreferences(); } }
/* Remove only cosmetic/preference cache, never authentication/session data. */
export function clearLocalPreferences(userId = "guest") {
  try {
    localStorage.removeItem(storageKey(userId));
    localStorage.removeItem("timzee-ui-appearance");
    return true;
  } catch (_) {
    return false;
  }
}
export function writeLocalPreferences(userId, preferences) {
  const merged = mergePreferences(preferences);
  try {
    localStorage.setItem(storageKey(userId || "guest"), JSON.stringify(merged));
    localStorage.setItem("timzee-ui-appearance", JSON.stringify(merged.appearance || {}));
  } catch (_) {}
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
  for (const part of parts) { if (current == null || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, part)) return fallback; current = current[part]; }
  return typeof current === "undefined" ? fallback : current;
}
