import { supabase, getCurrentUser } from "./supabase.js";
import { loadUserPreferences, mergePreferences } from "./user-preferences.js";
import { escapeHTML, clampText, stripHTML, isSafeUrl, timeAgo, reportAppError } from "./utils.js";
import { diversifyFeed, feedCacheKey, cachedFeed } from "./feed-diversity.mjs";

const state = { user: null, preferences: mergePreferences(), type: "all", mode: "for-you", loading: false };
const feedCache = new Map();
const suppressedContent = new Set();
const $ = (id) => document.getElementById(id);

function rememberKey(userId) { return `timzee:fyp:last:${userId}`; }
function readQuery() {
  const params = new URLSearchParams(window.location.search);
  return { type: params.get("type") || "", mode: params.get("mode") || "" };
}
function readRemembered(userId) {
  if (!userId || !state.preferences.feed.rememberFilters) return { type: "all", mode: "" };
  try { return JSON.parse(localStorage.getItem(rememberKey(userId)) || "{}"); } catch (_) { return {}; }
}
function saveRemembered() {
  if (!state.user?.id || !state.preferences.feed.rememberFilters) return;
  try { localStorage.setItem(rememberKey(state.user.id), JSON.stringify({ type: state.type, mode: state.mode })); } catch (_) {}
}
function typeLabel(type) {
  return ({ all: "Everything", post: "Posts", discussion: "Discussions", video: "Videos", novel: "Novels", marketplace: "Marketplace" })[type] || "Everything";
}
function contentHref(row) {
  if (row.content_type === "post") return `post.html?id=${encodeURIComponent(row.content_id)}`;
  if (row.content_type === "discussion") return `discussion.html?topic=${encodeURIComponent(row.content_id)}`;
  if (row.content_type === "video") return `video.html?id=${encodeURIComponent(row.content_id)}`;
  if (row.content_type === "novel") return `novel.html?id=${encodeURIComponent(row.content_id)}`;
  if (row.content_type === "marketplace") return `listing.html?id=${encodeURIComponent(row.content_id)}`;
  return "#";
}
function renderRow(row) {
  const image = row.image_url && isSafeUrl(row.image_url) ? `<img src="${escapeHTML(row.image_url)}" alt="${escapeHTML(row.title || `${typeLabel(row.content_type)} preview`)}" loading="lazy">` : `<div class="fyp-media-fallback" aria-hidden="true">${escapeHTML(typeLabel(row.content_type).toUpperCase())}</div>`;
  const reason = row.reason ? `<span class="fyp-reason">${escapeHTML(row.reason)}</span>` : "";
  const body = clampText(stripHTML(row.excerpt || ""), 190);
  return `<article class="fyp-card" data-content-type="${escapeHTML(row.content_type)}" data-content-id="${escapeHTML(row.content_id)}"><a class="fyp-media" href="${contentHref(row)}">${image}</a><div class="fyp-card-body"><div class="fyp-meta"><span class="chip">${escapeHTML(typeLabel(row.content_type))}</span><span>${escapeHTML(row.category || "")}</span><span>${timeAgo(row.created_at)}</span></div><a href="${contentHref(row)}"><h2>${escapeHTML(row.title || "Untitled")}</h2></a><p>${escapeHTML(body)}</p><div class="fyp-card-foot"><span>${reason}</span><button type="button" class="btn ghost sm" data-fyp-action="not-interested">Not interested</button></div></div></article>`;
}
function updateUrl() {
  const params = new URLSearchParams();
  if (state.mode !== "for-you") params.set("mode", state.mode);
  if (state.type !== "all") params.set("type", state.type);
  window.history.replaceState({}, "", `fyp.html${params.toString() ? `?${params}` : ""}`);
}
function applyActiveControls() {
  document.querySelectorAll("[data-fyp-mode]").forEach(button => {
    const active = button.dataset.fypMode === state.mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-fyp-filter]").forEach(button => {
    const active = button.dataset.fypFilter === state.type;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const label = $("fypModeLabel");
  if (label) label.textContent = state.mode === "following" ? "Following" : "For You";
}
let feedVersion = 0;
async function loadFeed({ force = false } = {}) {
  const version = ++feedVersion;
  const target = $("fypGrid");
  if (!target) return;
  state.loading = true;
  target.setAttribute("aria-busy", "true");
  target.innerHTML = `<div class="callout">Building your ${state.mode === "following" ? "following" : "personalized"} feed…</div>`;
  const refresh = $("refreshFypBtn");
  if (refresh) refresh.disabled = true;
  const mode = state.mode, type = state.type;
  try {
    if (mode === "for-you" && !state.preferences.feed.showRecommendations) {
      target.innerHTML = `<div class="fyp-empty card"><h2>Recommendations are off</h2><p>Your For You feed is paused in settings. Switch to Following or turn recommendations back on.</p><div class="settings-inline-actions"><button class="btn" type="button" data-fyp-mode="following">Open Following</button><a class="btn ghost" href="settings.html#feed">Open feed settings</a></div></div>`;
      target.querySelector('[data-fyp-mode="following"]')?.addEventListener("click", () => {
        state.mode = "following"; saveRemembered(); updateUrl(); applyActiveControls(); void loadFeed();
      });
      return;
    }
    const key = feedCacheKey(mode, type);
    let rows = !force ? cachedFeed(feedCache, key) : null;
    if (!rows) {
      const rpcName = mode === "following" ? "get_following_feed" : "get_personalized_feed";
      const response = await supabase.rpc(rpcName, {
        p_limit: 40, p_content_type: type === "all" ? "all" : type
      });
      if (version !== feedVersion) return;
      if (response.error) throw response.error;
      rows = diversifyFeed(response.data || [], { mode });
      feedCache.set(key, { time: Date.now(), rows });
    }
    if (version !== feedVersion) return;
    const visible = rows.filter(row => !suppressedContent.has(row.content_type + ":" + row.content_id));
    target.innerHTML = visible.length
      ? visible.map(renderRow).join("")
      : `<div class="fyp-empty card"><h2>${mode === "following" ? "Nothing from followed creators yet" : "No recommendations yet"}</h2><p>${mode === "following" ? "Follow creators or communities to see their updates here." : "Like posts, follow people and choose Not interested to improve future recommendations."}</p><a class="btn" href="index.html">Explore the community</a></div>`;
  } catch (error) {
    if (version !== feedVersion) return;
    target.innerHTML = '<div class="callout" role="alert">Unable to load your feed right now. <button class="btn ghost sm" type="button" id="retryFypBtn">Retry</button></div>';
    target.querySelector("#retryFypBtn")?.addEventListener("click", () => void loadFeed({ force: true }));
    console.warn("Feed loading failed:", error);
  } finally {
    if (version === feedVersion) {
      state.loading = false;
      target.setAttribute("aria-busy", "false");
      if (refresh) refresh.disabled = false;
    }
  }
}
async function markNotInterested(card) {
  if (!state.user || !card || card.dataset.feedbackPending === "true") return;
  const button = card.querySelector('[data-fyp-action="not-interested"]');
  const contentType = card.dataset.contentType, contentId = card.dataset.contentId;
  const key = contentType + ":" + contentId;
  card.dataset.feedbackPending = "true";
  if (button) { button.disabled = true; button.textContent = "Saving…"; }
  try {
    const result = await supabase.from("user_content_feedback").upsert({
      user_id: state.user.id, content_type: contentType,
      content_id: contentId, action: "not_interested"
    }, { onConflict: "user_id,content_type,content_id" });
    if (result.error) throw result.error;
    suppressedContent.add(key);
    feedCache.clear(); // Next recommendation request must use new feedback.
    card.remove();
    const notice = $("fypFeedbackStatus");
    if (notice) {
      notice.replaceChildren(document.createTextNode("This recommendation is hidden. "));
      const undo = document.createElement("button");
      undo.type = "button"; undo.className = "btn ghost sm"; undo.textContent = "Undo";
      undo.addEventListener("click", async () => {
        undo.disabled = true;
        const rollback = await supabase.from("user_content_feedback").delete()
          .eq("user_id", state.user.id).eq("content_type", contentType)
          .eq("content_id", contentId).eq("action", "not_interested");
        if (rollback.error) {
          undo.disabled = false;
          notice.firstChild.textContent = "Could not undo that choice. ";
          return;
        }
        suppressedContent.delete(key);
        feedCache.clear();
        notice.textContent = "Preference restored.";
        void loadFeed({ force: true });
      }, { once: true });
      notice.append(undo);
    }
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = "Not interested"; }
    throw error;
  } finally {
    delete card.dataset.feedbackPending;
  }
}
function wire() {
  document.querySelectorAll("[data-fyp-mode]").forEach((button) => button.addEventListener("click", () => { state.mode = button.dataset.fypMode || "for-you"; saveRemembered(); updateUrl(); applyActiveControls(); void loadFeed(); }));
  document.querySelectorAll("[data-fyp-filter]").forEach((button) => button.addEventListener("click", () => { state.type = button.dataset.fypFilter || "all"; saveRemembered(); updateUrl(); applyActiveControls(); void loadFeed(); }));
  $("refreshFypBtn")?.addEventListener("click", () => void loadFeed({ force: true }));
  $("fypGrid")?.addEventListener("click", async (event) => { const action = event.target.closest("[data-fyp-action]"); if (!action) return; event.preventDefault(); const card = action.closest(".fyp-card"); try { await markNotInterested(card); } catch (error) { reportAppError(error, "Recommendation feedback failed"); } });
}
async function boot() {
  state.user = await getCurrentUser();
  if (!state.user) { window.location.href = `login.html?next=${encodeURIComponent(window.location.href)}`; return; }
  state.preferences = mergePreferences(await loadUserPreferences(state.user));
  const query = readQuery();
  const remembered = readRemembered(state.user.id);
  state.type = query.type || remembered.type || "all";
  state.mode = query.mode === "following" ? "following" : query.mode === "for-you" ? "for-you" : remembered.mode === "following" ? "following" : state.preferences.feed.defaultFeed === "following" && !query.mode && !query.type && !remembered.mode ? "following" : "for-you";
  applyActiveControls(); wire(); await loadFeed();
}
boot().catch((error) => reportAppError(error, "For You page failed to initialize"));
