import { getCurrentUser } from "./supabase.js";
import { loadUserPreferences, mergePreferences } from "./user-preferences.js";

function getContextFromUrl() {
  const value = new URLSearchParams(window.location.search).get("context") || "";
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

async function boot() {
  const context = getContextFromUrl();
  if (!context) return;
  const user = await getCurrentUser();
  if (user) {
    const preferences = mergePreferences(await loadUserPreferences(user));
    if (preferences.ai?.assistantContext === false) return;
  }
  const input = document.getElementById("aiChatInput");
  if (!input) return;
  const prefix = "Use this selected context from Timzee Tech Hub and help me understand it:\n\n";
  input.value = context.startsWith(prefix) ? context : `${prefix}${context}`;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  input.focus();
  window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void boot(), { once: true });
else void boot();
