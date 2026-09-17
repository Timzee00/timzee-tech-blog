import { supabase, getCurrentUser } from "./supabase.js";
import { loadUserPreferences, saveUserPreferences, mergePreferences, writeLocalPreferences } from "./user-preferences.js";
import { reportAppError } from "./utils.js";

const $ = (id) => document.getElementById(id);
const statusEl = $("settingsStatus");
let state = { user: null, preferences: null, profile: null, saving: false, timer: null };

function setStatus(message, tone = "") {
  if (!statusEl) return;
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function getByPath(object, path, fallback = undefined) {
  return String(path || "").split(".").filter(Boolean).reduce((value, key) => {
    if (value == null || !(key in value)) return fallback;
    return value[key];
  }, object);
}

function setByPath(object, path, value) {
  const parts = String(path || "").split(".").filter(Boolean);
  if (!parts.length) return;
  let target = object;
  parts.slice(0, -1).forEach((part) => {
    if (!target[part] || typeof target[part] !== "object") target[part] = {};
    target = target[part];
  });
  target[parts.at(-1)] = value;
}

function controlValue(input) {
  return input.type === "checkbox" ? input.checked : input.value;
}

function applyControls() {
  document.querySelectorAll("[data-path]").forEach((input) => {
    const value = getByPath(state.preferences, input.dataset.path);
    if (input.type === "checkbox") input.checked = Boolean(value);
    else if (value != null) input.value = String(value);
  });

  const profileMap = {
    allow_messages: "allow_messages",
    allow_requests: "allow_requests",
    show_email: "show_email"
  };
  Object.entries(profileMap).forEach(([key, column]) => {
    const input = document.querySelector(`[data-profile-setting="${key}"]`);
    if (input) input.checked = Boolean(state.profile?.[column]);
  });
}

async function loadProfile() {
  const result = await supabase
    .from("profiles")
    .select("allow_messages,allow_requests,show_email,notify_messages,notify_replies,notify_follows,notify_mentions")
    .eq("id", state.user.id)
    .maybeSingle();
  if (result.error) throw result.error;
  state.profile = result.data || {};

  const notificationMap = {
    messages: "notify_messages",
    replies: "notify_replies",
    follows: "notify_follows",
    mentions: "notify_mentions"
  };
  Object.entries(notificationMap).forEach(([pref, column]) => {
    if (typeof state.profile[column] === "boolean") state.preferences.notifications[pref] = state.profile[column];
  });
}

async function saveAll() {
  if (!state.user || state.saving) return;
  state.saving = true;
  setStatus("Saving…");
  try {
    const profileUpdates = {};
    document.querySelectorAll("[data-profile-setting]").forEach((input) => {
      profileUpdates[input.dataset.profileSetting] = input.checked;
    });

    const notificationColumns = {
      messages: "notify_messages",
      replies: "notify_replies",
      follows: "notify_follows",
      mentions: "notify_mentions"
    };
    Object.entries(notificationColumns).forEach(([pref, column]) => {
      profileUpdates[column] = Boolean(state.preferences.notifications[pref]);
    });

    const profileResult = await supabase.from("profiles").update(profileUpdates).eq("id", state.user.id);
    if (profileResult.error) throw profileResult.error;

    await saveUserPreferences(state.user.id, state.preferences);
    setStatus("Saved", "success");
  } catch (error) {
    setStatus(error?.message || "Could not save settings.", "error");
    reportAppError(error, "Settings save failed");
  } finally {
    state.saving = false;
  }
}

function scheduleSave() {
  clearTimeout(state.timer);
  setStatus("Changes pending…");
  state.timer = window.setTimeout(() => void saveAll(), 500);
}

function wireControls() {
  document.querySelectorAll("[data-path]").forEach((input) => {
    input.addEventListener("change", () => {
      setByPath(state.preferences, input.dataset.path, controlValue(input));
      scheduleSave();
    });
  });
  document.querySelectorAll("[data-profile-setting]").forEach((input) => input.addEventListener("change", scheduleSave));

  $("clearLocalDataBtn")?.addEventListener("click", () => {
    writeLocalPreferences(state.user.id, mergePreferences());
    setStatus("Local preferences cleared. Server preferences remain saved.", "success");
  });

  $("cookieSettingsBtn")?.addEventListener("click", () => {
    if (typeof window.openCookieSettings === "function") window.openCookieSettings();
    else setStatus("Cookie settings are available from the privacy banner on this page.");
  });

  const nav = $("settingsNav");
  const links = [...(nav?.querySelectorAll("a") || [])];
  const sections = links.map((link) => document.querySelector(link.getAttribute("href"))).filter(Boolean);
  if (links.length && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        const link = nav.querySelector(`a[href="#${entry.target.id}"]`);
        if (link && entry.isIntersecting) {
          links.forEach((item) => item.classList.remove("active"));
          link.classList.add("active");
        }
      });
    }, { rootMargin: "-20% 0px -65% 0px", threshold: 0 });
    sections.forEach((section) => observer.observe(section));
  }
}

async function boot() {
  state.user = await getCurrentUser();
  if (!state.user) {
    setStatus("Sign in to save personal settings.");
    document.querySelectorAll("input,select,button[data-path]").forEach((control) => {
      if (!control.closest("#cookies")) control.disabled = true;
    });
    return;
  }
  state.preferences = mergePreferences(await loadUserPreferences(state.user));
  await loadProfile();
  applyControls();
  wireControls();
  setStatus("Settings loaded", "success");
}

boot().catch((error) => {
  setStatus(error?.message || "Could not load settings.", "error");
  reportAppError(error, "Settings page load failed");
});
