import { supabase } from "./supabase.js";
import { escapeHTML, stripHTML, clampText, isSafeUrl, timeAgo } from "./utils.js";

const TRACK_ID = "popularTrack";
const LIMIT = 5;
let rendering = false;
let refreshTimer = null;

function buildCard(post) {
  const media = isSafeUrl(post.cover || "")
    ? `<img src="${escapeHTML(post.cover)}" alt="${escapeHTML(post.title || "Post cover")}" loading="lazy">`
    : `<div class="popular-media-fallback" aria-hidden="true"><span>${escapeHTML((post.content_type || "POST").toUpperCase())}</span></div>`;
  const summary = escapeHTML(clampText(stripHTML(post.content || ""), 150));
  return `<article class="popular-card" data-popular-score="${escapeHTML(String(post.popularity_score || 0))}">
      <a class="popular-media" href="post.html?id=${encodeURIComponent(post.id)}">${media}</a>
      <div class="popular-body">
        <div class="popular-meta"><span>${Number(post.like_count || 0)} likes</span><span>${Number(post.comment_count || 0)} replies</span><span>${Number(post.share_count || 0)} shares</span></div>
        <a href="post.html?id=${encodeURIComponent(post.id)}"><h3>${escapeHTML(post.title || "Untitled post")}</h3></a>
        <div class="popular-summary">${summary}</div>
        <div class="popular-card-foot"><span>${escapeHTML(post.author_name || "Timzee Tech Hub")}</span><span>${timeAgo(post.publish_at || post.created_at)}</span></div>
      </div>
    </article>`;
}

async function renderPopular(categoryId = null) {
  const track = document.getElementById(TRACK_ID);
  if (!track || rendering) return;
  rendering = true;
  track.setAttribute("aria-busy", "true");
  track.dataset.popularitySource = "automated";
  try {
    const category = categoryId && categoryId !== "all" ? categoryId : null;
    const result = await supabase.rpc("get_popular_posts", { limit_count: LIMIT, category_filter: category });
    if (result.error) throw result.error;
    const rows = result.data || [];
    track.innerHTML = rows.length ? rows.map(buildCard).join("") : `<div class="callout">No published posts have enough activity to surface yet.</div>`;
  } catch (error) {
    console.warn("Automated popular ranking failed; retaining current content:", error);
  } finally {
    track.setAttribute("aria-busy", "false");
    rendering = false;
  }
}

function scheduleRefresh(categoryId = null) {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = setTimeout(() => { refreshTimer = null; void renderPopular(categoryId); }, 120);
}

function boot() {
  const track = document.getElementById(TRACK_ID);
  if (!track) return;
  scheduleRefresh();
  const categoryNav = document.getElementById("categoryNav");
  categoryNav?.addEventListener("click", (event) => {
    const link = event.target.closest("[data-category]");
    if (link) scheduleRefresh(link.dataset.category || "all");
  });

  const observer = new MutationObserver(() => {
    if (rendering) return;
    /* app.js can re-render the homepage after its initial settings load. Re-assert the database ranking instead of allowing manual labels/content to win. */
    scheduleRefresh();
  });
  observer.observe(track, { childList: true, subtree: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
