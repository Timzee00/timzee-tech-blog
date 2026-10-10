import { supabase } from "./supabase.js";
import { escapeHTML, stripHTML, clampText, isSafeUrl, timeAgo } from "./utils.js";

const TRACK_ID = "popularTrack";
const LIMIT = 5;
let requestVersion = 0;

function buildCard(post) {
  const media = isSafeUrl(post.cover || "")
    ? `<img src="${escapeHTML(post.cover)}" alt="${escapeHTML(post.title || "Post cover")}" loading="lazy">`
    : `<div class="popular-media-fallback" aria-hidden="true"><span>${escapeHTML((post.content_type || "POST").toUpperCase())}</span></div>`;
  const summary = escapeHTML(clampText(stripHTML(post.content || ""), 150));
  return `<article class="popular-card" data-popular-score="${escapeHTML(String(post.popularity_score || 0))}">
      <a class="popular-media" aria-label="${escapeHTML(post.title || 'Read post')}" href="post.html?id=${encodeURIComponent(post.id)}">${media}</a>
      <div class="popular-body">
        <div class="popular-meta"><span>${Number(post.like_count || 0)} likes</span><span>${Number(post.comment_count || 0)} replies</span><span>${Number(post.share_count || 0)} shares</span></div>
        <a href="post.html?id=${encodeURIComponent(post.id)}"><h3>${escapeHTML(post.title || "Untitled post")}</h3></a>
        <div class="popular-summary">${summary}</div>
        <div class="popular-card-foot"><span>${escapeHTML(post.author_name || "Timzee Tech Hub")}</span><span>${timeAgo(post.publish_at || post.created_at)}</span></div>
      </div>
    </article>`;
}

function installMediaFallbacks(track) {
  track.querySelectorAll(".popular-media img").forEach((image) => {
    image.addEventListener("error", () => {
      const fallback = document.createElement("div");
      fallback.className = "popular-media-fallback";
      const label = document.createElement("span");
      label.textContent = "Article";
      fallback.appendChild(label);
      image.replaceWith(fallback);
    }, { once: true });
    // Cached failed image responses may have completed before we attached a listener.
    if (image.complete && image.naturalWidth === 0) image.dispatchEvent(new Event("error"));
  });
}

export async function renderPopular(categoryId = null) {
  const track = document.getElementById(TRACK_ID);
  if (!track) return;
  const version = ++requestVersion;
  track.setAttribute("aria-busy", "true");
  track.dataset.popularitySource = "automated";
  try {
    const category = categoryId && categoryId !== "all" ? categoryId : null;
    const result = await supabase.rpc("get_popular_posts", { limit_count: LIMIT, category_filter: category });
    if (version !== requestVersion) return;
    if (result.error) throw result.error;
    const rows = result.data || [];
    track.innerHTML = rows.length ? rows.map(buildCard).join("") : `<div class="callout">No published posts have enough activity to surface yet.</div>`;
    installMediaFallbacks(track);
  } catch (error) {
    if (version !== requestVersion) return;
    track.innerHTML = `<div class="callout">This section is unavailable right now. Try refreshing the page.</div>`;
    console.warn("Automated popular ranking failed; retaining current content:", error);
  } finally {
    if (version === requestVersion) track.setAttribute("aria-busy", "false");

  }
}
