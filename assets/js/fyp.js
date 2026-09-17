import { supabase, getCurrentUser } from "./supabase.js";
import { loadUserPreferences, mergePreferences } from "./user-preferences.js";
import { escapeHTML, clampText, stripHTML, isSafeUrl, timeAgo, reportAppError } from "./utils.js";

const state = { user: null, preferences: mergePreferences(), type: "all", mode: "for-you", loading: false };
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
  document.querySelectorAll("[data-fyp-mode]").forEach((button) => button.classList.toggle("active", button.dataset.fypMode === state.mode));
  document.querySelectorAll("[data-fyp-filter]").forEach((button) => button.classList.toggle("active", button.dataset.fypFilter === state.type));
  const label = $("fypModeLabel");
  if (label) label.textContent = state.mode === "following" ? "Following" : "For You";
}
async function loadFeed() {
  const target = $("fypGrid"); if (!target || state.loading) return;
  state.loading = true; target.setAttribute("aria-busy", "true"); target.innerHTML = `<div class="callout">Building your ${state.mode === "following" ? "following" : "personalized"} feed…</div>`;
  try {
    if (state.mode === "for-you" && !state.preferences.feed.showRecommendations) {
      target.innerHTML = `<div class="fyp-empty card"><h2>Recommendations are off</h2><p>Your For You feed is paused in settings. Switch to Following or turn recommendations back on.</p><div class="settings-inline-actions"><button class="btn" type="button" data-fyp-mode="following">Open Following</button><a class="btn ghost" href="settings.html#feed">Open feed settings</a></div></div>`;
      const switchButton = target.querySelector('[data-fyp-mode="following"]');
      switchButton?.addEventListener("click", () => { state.mode = "following"; saveRemembered(); updateUrl(); applyActiveControls(); void loadFeed(); });
      return;
    }
    const rpcName = state.mode === "following" ? "get_following_feed" : "get_personalized_feed";
    const result = await supabase.rpc(rpcName, { p_limit: 30, p_content_type: state.type === "all" ? "all" : state.type });
    if (result.error) throw result.error;
    const rows = result.data || [];
    target.innerHTML = rows.length ? rows.map(renderRow).join("") : `<div class="fyp-empty card"><h2>${state.mode === "following" ? "Nothing from followed creators yet" : "No recommendations yet"}</h2><p>${state.mode === "following" ? "Follow creators or communities and their new content will collect here." : "Follow creators and communities, save useful posts, like topics you enjoy, and your feed will learn from those signals."}</p><a class="btn" href="index.html">Explore the community</a></div>`;
  } catch (error) {
    target.innerHTML = `<div class="callout">Unable to load your feed right now. Please try again.</div>`; reportAppError(error, "Feed loading failed");
  } finally { state.loading = false; target.setAttribute("aria-busy", "false"); }
}
async function markNotInterested(card) {
  if (!state.user || !card) return;
  const result = await supabase.from("user_content_feedback").upsert({ user_id: state.user.id, content_type: card.dataset.contentType, content_id: card.dataset.contentId, action: "not_interested" }, { onConflict: "user_id,content_type,content_id" });
  if (result.error) throw result.error; card.remove();
}
function wire() {
  document.querySelectorAll("[data-fyp-mode]").forEach((button) => button.addEventListener("click", () => { state.mode = button.dataset.fypMode || "for-you"; saveRemembered(); updateUrl(); applyActiveControls(); void loadFeed(); }));
  document.querySelectorAll("[data-fyp-filter]").forEach((button) => button.addEventListener("click", () => { state.type = button.dataset.fypFilter || "all"; saveRemembered(); updateUrl(); applyActiveControls(); void loadFeed(); }));
  $("refreshFypBtn")?.addEventListener("click", () => void loadFeed());
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
