import { getCurrentUser } from "./supabase.js";
import { loadUserPreferences, mergePreferences } from "./user-preferences.js";
import { takeChatContext } from "./chat-ai-context.mjs";
import { reportAppError } from "./utils.js";

async function boot() {
  const url = new URL(window.location.href);
  const ref = url.searchParams.get('context_ref');
  // Keep old public links compatible, but remove their context before any await.
  const legacy = url.searchParams.get('context') || '';
  if (!ref && !legacy) return;
  url.searchParams.delete('context_ref'); url.searchParams.delete('context');
  window.history.replaceState(window.history.state, document.title, url.pathname + url.search + url.hash);
  const user = await getCurrentUser();
  const context = ref ? takeChatContext(ref, user?.id) : legacy.slice(0, 12000);
  if (!context || !user) return;
  const preferences = mergePreferences(await loadUserPreferences(user));
  if (preferences.ai?.assistantContext === false) return;
  const input = document.getElementById("aiChatInput");
  if (!input || input.value) return;
  const prefix = "Use this selected context from Timzee Tech Hub and help me understand it:\n\n";
  input.value = context.startsWith(prefix) ? context : `${prefix}${context}`;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.focus();
}
const start = () => void boot().catch(error => reportAppError(error, 'Unable to load selected context'));
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
else start();
