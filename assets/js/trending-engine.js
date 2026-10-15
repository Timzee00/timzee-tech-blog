import { supabase } from "./supabase.js";
import { escapeHTML, stripHTML, clampText, isSafeUrl, timeAgo } from "./utils.js";

const TRACK_ID = "trendingList";
const LIMIT = 3;
let requestVersion = 0;
let lastCategory = null;

function card(post) {
  return `<article class="trending-card post-card">
    <div class="post-card-header"><span class="chip">Trending</span><span class="post-card-subline">${Number(post.recent_engagement || 0)} recent interactions · ${timeAgo(post.publish_at || post.created_at)}</span></div>
    <a href="post.html?id=${encodeURIComponent(post.id)}"><h3>${escapeHTML(post.title || "Untitled post")}</h3></a>
    <div class="post-card-excerpt">${escapeHTML(clampText(stripHTML(post.content || ""), 125))}</div>
    <div class="post-card-subline">${Number(post.like_count || 0)} likes · ${Number(post.comment_count || 0)} replies · ${Number(post.share_count || 0)} shares</div>
  </article>`;
}

export async function renderTrending(categoryId = null) {
  const target = document.getElementById(TRACK_ID);
  if (!target) return;
  lastCategory = categoryId && categoryId !== "all" ? categoryId : null;
  const version = ++requestVersion;
  target.setAttribute("aria-busy", "true");
  try {
    const result = await supabase.rpc("get_trending_posts", { limit_count: LIMIT, category_filter: lastCategory });
    if (version !== requestVersion) return;
    if (result.error) throw result.error;
    const rows = result.data || [];
    target.innerHTML = rows.length ? rows.map(card).join("") : `<div class="callout">Nothing is heating up yet. Recent activity will surface here automatically.</div>`;
  } catch (error) {
    if (version !== requestVersion) return;
    target.innerHTML = `<div class="callout">This section is unavailable right now. Try refreshing the page.</div>`;
    console.warn("Automated trending ranking failed:", error);
  } finally {
    if (version === requestVersion) target.setAttribute("aria-busy", "false");

  }
}
