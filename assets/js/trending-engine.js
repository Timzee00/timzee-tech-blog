import { supabase } from "./supabase.js";
import { escapeHTML, stripHTML, clampText, isSafeUrl, timeAgo } from "./utils.js";

const TRACK_ID = "trendingList";
const LIMIT = 5;
let rendering = false;
let lastCategory = null;

function card(post) {
  const media = post.cover && isSafeUrl(post.cover)
    ? `<img src="${escapeHTML(post.cover)}" alt="${escapeHTML(post.title || "Trending post")}" loading="lazy">`
    : `<div class="popular-media-fallback" aria-hidden="true">TRENDING</div>`;
  return `<article class="trending-card post-card">
    <a class="popular-media" href="post.html?id=${encodeURIComponent(post.id)}">${media}</a>
    <div class="post-card-header"><span class="chip">Trending</span><span class="post-card-subline">${Number(post.recent_engagement || 0)} recent interactions · ${timeAgo(post.publish_at || post.created_at)}</span></div>
    <a href="post.html?id=${encodeURIComponent(post.id)}"><h3>${escapeHTML(post.title || "Untitled post")}</h3></a>
    <div class="post-card-excerpt">${escapeHTML(clampText(stripHTML(post.content || ""), 125))}</div>
    <div class="post-card-subline">${Number(post.like_count || 0)} likes · ${Number(post.comment_count || 0)} replies · ${Number(post.share_count || 0)} shares</div>
  </article>`;
}

async function renderTrending(categoryId = null) {
  const target = document.getElementById(TRACK_ID);
  if (!target || rendering) return;
  lastCategory = categoryId && categoryId !== "all" ? categoryId : null;
  rendering = true;
  target.setAttribute("aria-busy", "true");
  try {
    const result = await supabase.rpc("get_trending_posts", { limit_count: LIMIT, category_filter: lastCategory });
    if (result.error) throw result.error;
    const rows = result.data || [];
    target.innerHTML = rows.length ? rows.map(card).join("") : `<div class="callout">Nothing is heating up yet. Recent activity will surface here automatically.</div>`;
  } catch (error) {
    console.warn("Automated trending ranking failed:", error);
  } finally {
    target.setAttribute("aria-busy", "false");
    rendering = false;
  }
}

function boot() {
  const target = document.getElementById(TRACK_ID);
  if (!target) return;
  window.setTimeout(() => renderTrending(), 10);
  document.getElementById("categoryNav")?.addEventListener("click", (event) => {
    const link = event.target.closest("[data-category]");
    if (!link) return;
    window.setTimeout(() => renderTrending(link.dataset.category || "all"), 80);
  });
  const observer = new MutationObserver(() => {
    if (rendering) return;
    if (!target.dataset.trendingOwned) {
      target.dataset.trendingOwned = "true";
      return;
    }
    const hasTrendingCard = target.querySelector(".trending-card");
    if (!hasTrendingCard && target.getAttribute("aria-busy") !== "true") window.setTimeout(() => renderTrending(lastCategory), 120);
  });
  observer.observe(target, { childList: true, subtree: true });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
else boot();
