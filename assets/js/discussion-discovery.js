import { supabase, getCurrentUser } from "./supabase.js";
import { escapeHTML, stripHTML, clampText, timeAgo, reportAppError } from "./utils.js";

const state = { user: null, mode: "trending", topics: [] };
const $ = (id) => document.getElementById(id);

function ensureDiscoveryMount() {
  const shell = $("discussionShell");
  if (!shell || $("discussionDiscovery")) return null;
  const wrapper = document.createElement("section");
  wrapper.id = "discussionDiscovery";
  wrapper.className = "discussion-discovery container";
  wrapper.innerHTML = `
    <div class="discussion-discovery-head">
      <div><span class="discussion-discovery-kicker">Discovery</span><h1>Find the conversation worth joining.</h1><p>Trending measures recent acceleration. Popular measures sustained community activity. New and unanswered give you different ways in.</p></div>
      <a class="btn ghost" href="settings.html#discussion">Discussion settings</a>
    </div>
    <div class="discussion-discovery-tabs" role="tablist" aria-label="Discussion discovery">
      <button class="discussion-discovery-tab active" type="button" data-discovery-mode="trending">Trending</button>
      <button class="discussion-discovery-tab" type="button" data-discovery-mode="popular">Popular</button>
      <button class="discussion-discovery-tab" type="button" data-discovery-mode="new">New</button>
      <button class="discussion-discovery-tab" type="button" data-discovery-mode="active">Most active</button>
      <button class="discussion-discovery-tab" type="button" data-discovery-mode="unanswered">Unanswered</button>
    </div>
    <div id="discussionDiscoveryGrid" class="discussion-discovery-grid" aria-live="polite"></div>
  `;
  shell.parentNode?.insertBefore(wrapper, shell);
  return wrapper;
}

function topicCard(topic) {
  const modeValue = state.mode === "trending" ? topic.trending_score : topic.popularity_score;
  const signal = state.mode === "trending"
    ? `${Number(topic.recent_reply_count || 0)} replies in 72h`
    : `${Number(topic.reply_count || 0)} replies`;
  const description = clampText(stripHTML(topic.description || ""), 145);
  return `<article class="discussion-discovery-card" data-topic-id="${escapeHTML(topic.id)}">
    <div class="discussion-discovery-card-top"><span class="chip">${escapeHTML(state.mode === "trending" ? "Trending" : state.mode === "popular" ? "Popular" : state.mode === "new" ? "New" : state.mode === "unanswered" ? "Unanswered" : "Active")}</span><span>${escapeHTML(signal)}</span></div>
    <button class="discussion-discovery-title" type="button" data-open-topic="${escapeHTML(topic.id)}">${escapeHTML(topic.title || "Untitled community")}</button>
    <p>${escapeHTML(description)}</p>
    <div class="discussion-discovery-foot"><span>Started by ${escapeHTML(topic.author_name || "Member")}</span><span>${timeAgo(topic.updated_at || topic.created_at)}</span></div>
  </article>`;
}

async function queryMode(mode) {
  if (mode === "trending") {
    const result = await supabase.rpc("get_trending_discussion_topics", { limit_count: 8 });
    if (result.error) throw result.error;
    return result.data || [];
  }
  if (mode === "popular") {
    const result = await supabase.rpc("get_popular_discussion_topics", { limit_count: 8 });
    if (result.error) throw result.error;
    return result.data || [];
  }

  let base = supabase.from("discussion_topics").select("id,title,description,author_id,author_name,created_at,updated_at");
  if (mode === "new") base = base.order("created_at", { ascending: false }).limit(8);
  else if (mode === "active") base = base.order("updated_at", { ascending: false }).limit(8);
  else {
    const messages = await supabase.from("discussion_messages").select("topic_id");
    if (messages.error) throw messages.error;
    const counts = {};
    (messages.data || []).forEach((m) => { counts[m.topic_id] = (counts[m.topic_id] || 0) + 1; });
    const topics = await supabase.from("discussion_topics").select("id,title,description,author_id,author_name,created_at,updated_at").order("created_at", { ascending: false });
    if (topics.error) throw topics.error;
    return (topics.data || []).filter((t) => !counts[t.id]).slice(0, 8).map((t) => ({ ...t, reply_count: 0, recent_reply_count: 0 }));
  }
  const result = await base;
  if (result.error) throw result.error;
  return result.data || [];
}

async function load(mode = state.mode) {
  const grid = $("discussionDiscoveryGrid");
  if (!grid) return;
  state.mode = mode;
  grid.innerHTML = `<div class="callout">Loading ${escapeHTML(mode)} discussions…</div>`;
  try {
    state.topics = await queryMode(mode);
    grid.innerHTML = state.topics.length
      ? state.topics.map(topicCard).join("")
      : `<div class="callout">No ${escapeHTML(mode)} discussions to show yet.</div>`;
  } catch (error) {
    grid.innerHTML = `<div class="callout">Unable to load discussion discovery right now.</div>`;
    reportAppError(error, "Discussion discovery failed");
  }
}

function openTopic(topicId) {
  const item = document.querySelector(`.topic-item[data-id="${CSS.escape(topicId)}"]`);
  if (item) {
    item.click();
    document.getElementById("discussionShell")?.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  window.location.href = `discussion.html?topic=${encodeURIComponent(topicId)}`;
}

function wire(wrapper) {
  wrapper.addEventListener("click", (event) => {
    const modeButton = event.target.closest("[data-discovery-mode]");
    if (modeButton) {
      document.querySelectorAll("[data-discovery-mode]").forEach((button) => button.classList.toggle("active", button === modeButton));
      void load(modeButton.dataset.discoveryMode || "trending");
      return;
    }
    const open = event.target.closest("[data-open-topic]");
    if (open) openTopic(open.dataset.openTopic);
  });
}

async function boot() {
  const wrapper = ensureDiscoveryMount();
  if (!wrapper) return;
  state.user = await getCurrentUser();
  wire(wrapper);
  await load("trending");
}

boot().catch((error) => reportAppError(error, "Discussion discovery initialization failed"));
