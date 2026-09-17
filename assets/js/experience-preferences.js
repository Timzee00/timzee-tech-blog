import { getCurrentUser } from "./supabase.js";
import { loadUserPreferences, mergePreferences } from "./user-preferences.js";

const DEFAULT_READER = { fontSize: "medium", readerWidth: "comfortable", rememberPosition: true };

function applyNovelPreferences(preferences) {
  const settings = { ...DEFAULT_READER, ...(preferences.novels || {}) };
  document.documentElement.dataset.readerFont = settings.fontSize;
  document.documentElement.dataset.readerWidth = settings.readerWidth;

  if (settings.rememberPosition) {
    document.querySelectorAll(".reader-content").forEach((reader) => {
      const key = `timzee:reader:${new URLSearchParams(window.location.search).get("id") || "novel"}`;
      try {
        const saved = Number(localStorage.getItem(key) || 0);
        if (saved > 0) reader.scrollTop = saved;
        reader.addEventListener("scroll", () => {
          try { localStorage.setItem(key, String(reader.scrollTop)); } catch (_) {}
        }, { passive: true });
      } catch (_) {}
    });
  }
}

function applyVideoPreferences(preferences) {
  const settings = preferences.videos || {};
  const sync = () => {
    document.querySelectorAll("video").forEach((video) => {
      video.muted = settings.mutedByDefault !== false;
      if (settings.autoplay === false) {
        video.autoplay = false;
        video.removeAttribute("autoplay");
      }
    });
  };
  sync();
  const observer = new MutationObserver(sync);
  observer.observe(document.body, { childList: true, subtree: true });
}

function applyChatPreferences(preferences) {
  const chat = preferences.chat || {};
  try {
    const current = JSON.parse(localStorage.getItem("timzee_chat_settings_v2") || "{}");
    localStorage.setItem("timzee_chat_settings_v2", JSON.stringify({
      ...current,
      notifications: chat.notifications !== false,
      sounds: chat.sounds !== false,
      enterToSend: chat.enterToSend !== false,
      compact: chat.compact === true
    }));
  } catch (_) {}
}

function applyDiscussionPreferences(preferences) {
  const sort = preferences.discussion?.defaultSort || "trending";
  const control = document.getElementById("discussionSort");
  if (!control) return;
  const mapping = { trending: "top", popular: "top", new: "new", active: "top", unanswered: "top" };
  const supported = mapping[sort] || "top";
  if ([...control.options].some((option) => option.value === supported)) {
    control.value = supported;
    control.dispatchEvent(new Event("change", { bubbles: true }));
  }
  document.documentElement.dataset.discussionDefault = sort;
}

function applyMarketplacePreferences(preferences) {
  const settings = preferences.marketplace || {};
  document.documentElement.dataset.marketplaceLocation = settings.showLocation === false ? "hidden" : "visible";
  document.documentElement.dataset.marketplaceCurrency = settings.currency || "NGN";

  if (settings.showLocation !== false) return;
  const hideListingLocation = () => {
    const location = document.getElementById("location");
    if (location?.parentElement?.classList.contains("detail-row")) location.parentElement.hidden = true;
  };
  hideListingLocation();
  const observer = new MutationObserver(hideListingLocation);
  observer.observe(document.body, { childList: true, subtree: true });
}

async function boot() {
  const user = await getCurrentUser();
  if (!user) return;
  const preferences = mergePreferences(await loadUserPreferences(user));
  const path = window.location.pathname.toLowerCase();
  if (path.endsWith("/novel.html")) applyNovelPreferences(preferences);
  if (path.endsWith("/video.html") || path.endsWith("/videos.html")) applyVideoPreferences(preferences);
  if (path.endsWith("/chat.html")) applyChatPreferences(preferences);
  if (path.endsWith("/discussion.html")) applyDiscussionPreferences(preferences);
  if (path.endsWith("/listing.html") || path.endsWith("/marketplace.html")) applyMarketplacePreferences(preferences);
  window.timzeePreferences = preferences;
}

if (typeof window !== "undefined") {
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void boot(), { once: true });
  else void boot();
}
