function getContextFromUrl() {
  const value = new URLSearchParams(window.location.search).get("context") || "";
  try { return decodeURIComponent(value); } catch (_) { return value; }
}

function boot() {
  const context = getContextFromUrl();
  if (!context) return;
  const input = document.getElementById("aiChatInput");
  if (!input) return;
  const prefix = "Use this selected context from Timzee Tech Hub and help me understand it:\n\n";
  input.value = context.startsWith(prefix) ? context : `${prefix}${context}`;
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  input.focus();
  window.history.replaceState({}, document.title, `${window.location.pathname}${window.location.hash}`);
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
