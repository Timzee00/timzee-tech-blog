import { supabase } from "./supabase.js";
import { escapeHTML, stripHTML, clampText, isSafeUrl, timeAgo } from "./utils.js";

const TRACK_ID = "popularTrack";
const LIMIT = 5;

function buildCard(post) {
  const media = isSafeUrl(post.cover || "")
    ? `<img src="${escapeHTML(post.cover)}" alt="${escapeHTML(post.title || "Post cover")}" loading="lazy">`
    : `<div class="popular-media-fallback" aria-hidden="true"><span>${escapeHTML((post.content_type || "POST").toUpperCase())}</span></div>`;
  const summary = escapeHTML(clampText(stripHTML(post.content || ""), 150));
  const scoreLabel = `Score ${Number(post.popularity_score || 0).toFixed(1)}`;
  return `
    <article class="popular-card" data-popular-score="${escapeHTML(String(post.popularity_score || 0))}">
      <a class="popular-media" href="post.html?id=${encodeURIComponent(post.id)}">
        ${media}
      </a>
      <div class="popular-body">
        <div class="popular-meta">
          <span>${escapeHTML(scoreLabel)}</span>
          <span>${Number(post.like_count || 0)} likes</span>
          <span>${Number(post.comment_count || 0)} replies</span>
          <span>${Number(post.share_count || 0)} shares</span>
        </div>
        <a href="post.html?id=${encodeURIComponent(post.id)}"><h3>${escapeHTML(post.title || "Untitled post")}</h3></a>
        <div class="popular-summary">${summary}</div>
        <div class="popular-card-foot">
          <span>${escapeHTML(post.author_name || "Timzee Tech Hub")}</span>
          <span>${timeAgo(post.publish_at || post.created_at)}</span>
        </div>
      </div>
    </article>
  `;
}

function readCategory() {
  const link = document.querySelector("#categoryNav [data-category].active, #categoryNav [aria-current='true']");
  return link?.dataset?.category || "all";
}

async function renderPopular(categoryId = null) {
  const track = document.getElementById(TRACK_ID);
  if (!track) return;

  track.setAttribute("aria-busy", "true");
  try {
    const category = categoryId && categoryId !== "all" ? categoryId : null;
    const result = await supabase.rpc("get_popular_posts", {
      limit_count: LIMIT,
      category_filter: category
    });
    if (result.error) throw result.error;
    const rows = result.data || [];
    track.innerHTML = rows.length
      ? rows.map(buildCard).join("")
      : `<div class="callout">No published posts have enough activity to surface yet.</div>`;
  } catch (error) {
    console.warn("Automated popular ranking failed; retaining existing content:", error);
  } finally {
    track.setAttribute("aria-busy", "false");
  }
}

function removeManualPopularLabels() {
  document.querySelectorAll(".post-card-header .chip").forEach((chip) => {
    if ((chip.textContent || "").trim().toLowerCase() === "popular") chip.remove();
  });
}

function boot() {
  const track = document.getElementById(TRACK_ID);
  if (!track) return;
  window.setTimeout(() => renderPopular(), 0);

  const categoryNav = document.getElementById("categoryNav");
  if (categoryNav) {
    categoryNav.addEventListener("click", (event) => {
      const link = event.target.closest("[data-category]");
      if (!link) return;
      window.setTimeout(() => renderPopular(link.dataset.category || "all"), 60);
    });
  }

  const observer = new MutationObserver(() => removeManualPopularLabels());
  observer.observe(document.body, { childList: true, subtree: true });
  removeManualPopularLabels();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
