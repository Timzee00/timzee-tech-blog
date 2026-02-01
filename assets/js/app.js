import { getCurrentUser, getCurrentUserWithRole, getDisplayName, getUserRole, signOut } from "./supabase.js";
import {
  fetchCategories,
  fetchPosts,
  fetchComments,
  fetchPostLikes,
  fetchAds,
  fetchDiscussionTopics,
  fetchDiscussionMessages,
  searchPosts,
  fetchTopProfiles,
  createContentRequest,
  togglePostLike,
  createPostShare
} from "./data.js";
import { fetchSettings } from "./settings.js";
import { fetchThemeById, applyThemeVariables } from "./themes.js";
import { timeAgo, readingTime, clampText, escapeHTML, stripHTML, normalizeTags, deriveLevel, isSafeUrl } from "./utils.js";
import { setupReveal } from "./reveal.js";
import "./nav.js";

const state = {
  activeCategory: "all",
  searchTerm: "",
  categories: [],
  posts: [],
  filteredPosts: null,
  comments: [],
  likes: [],
  likeCounts: {},
  commentCounts: {},
  userLikes: new Set(),
  user: null,
  settings: null,
  ads: [],
  discussionTopics: [],
  discussionMessages: [],
  activeTags: [],
  leaderboard: []
};

function formatBrandName(name) {
  const parts = name.split(" ").filter(Boolean);
  if (parts.length < 2) return name;
  const techIndex = parts.findIndex((part) => part.toLowerCase() === "tech");
  if (techIndex !== -1) {
    const highlighted = parts[techIndex];
    const before = parts.slice(0, techIndex).join(" ");
    const after = parts.slice(techIndex + 1).join(" ");
    return `${before ? `${before} ` : ""}<span>${highlighted}</span>${after ? ` ${after}` : ""}`;
  }
  const last = parts.pop();
  return `${parts.join(" ")} <span>${last}</span>`;
}

function applyTheme(settings) {
  if (settings.themeAccent) {
    document.documentElement.style.setProperty("--accent", settings.themeAccent);
  }
  const siteName = document.getElementById("siteName");
  const siteTagline = document.getElementById("siteTagline");
  const heroTitle = document.getElementById("heroTitle");
  const heroIntro = document.getElementById("heroIntro");
  if (siteName) siteName.innerHTML = formatBrandName(settings.siteName);
  if (siteTagline) siteTagline.textContent = settings.tagline;
  if (heroTitle) heroTitle.textContent = settings.heroTitle;
  if (heroIntro) heroIntro.textContent = settings.heroIntro;
}

function showAdminLinks() {
  const actions = document.querySelector(".header-actions");
  if (!actions || !state.user) return;
  const ensureLink = (id, text, href, className) => {
    let link = document.getElementById(id);
    if (!link) {
      link = document.createElement("a");
      link.id = id;
      link.href = href;
      link.textContent = text;
      link.className = className;
      actions.appendChild(link);
    }
  };
  const role = getUserRole(state.user);
  if (role === "admin" || role === "super") {
    ensureLink("adminLink", "Admin Portal", "admin/login.html", "btn ghost");
  }
  if (role === "super") {
    ensureLink("superLink", "God Mode", "super/login.html", "btn");
  }
}

function renderAuthActions() {
  const actions = document.querySelector(".header-actions");
  if (!actions) return;
  let authWrap = document.getElementById("authActions");
  if (!authWrap) {
    authWrap = document.createElement("div");
    authWrap.id = "authActions";
    authWrap.className = "auth-actions";
    actions.appendChild(authWrap);
  }
  authWrap.innerHTML = "";
  if (state.user) {
    const label = document.createElement("span");
    label.className = "auth-meta";
    label.textContent = getDisplayName(state.user);
    const profile = document.createElement("a");
    profile.className = "btn ghost";
    profile.href = `profile.html?id=${encodeURIComponent(state.user.id)}`;
    profile.textContent = "Profile";
    let notifications = document.getElementById("notificationLink");
    if (!notifications) {
      notifications = document.createElement("a");
      notifications.className = "btn ghost";
      notifications.href = "profile.html?tab=notifications";
      notifications.id = "notificationLink";
      notifications.innerHTML =
        'Notifications <span class="notif-count" id="notificationCount" style="display:none;">0</span>';
    }
    const chat = document.createElement("a");
    chat.className = "btn ghost";
    chat.href = "chat.html";
    chat.textContent = "Chat";
    const logout = document.createElement("button");
    logout.className = "btn ghost";
    logout.textContent = "Log Out";
    logout.addEventListener("click", async () => {
      await signOut();
      window.location.reload();
    });
    authWrap.appendChild(label);
    authWrap.appendChild(profile);
    authWrap.appendChild(notifications);
    authWrap.appendChild(chat);
    authWrap.appendChild(logout);
  } else {
    const login = document.createElement("a");
    login.className = "btn ghost";
    login.href = "login.html";
    login.textContent = "Log In";
    authWrap.appendChild(login);
  }
}

function renderNav(categories) {
  const nav = document.getElementById("categoryNav");
  if (!nav) return;
  nav.innerHTML = "";
  const allLink = document.createElement("a");
  allLink.href = "#latest";
  allLink.textContent = "All";
  allLink.dataset.category = "all";
  nav.appendChild(allLink);
  categories.forEach((cat) => {
    const link = document.createElement("a");
    link.href = "#latest";
    link.textContent = cat.name;
    link.dataset.category = cat.id;
    nav.appendChild(link);
  });
  nav.addEventListener("click", (event) => {
    const target = event.target.closest("a");
    if (!target) return;
    event.preventDefault();
    state.activeCategory = target.dataset.category || "all";
    renderTrending();
    renderPopular();
    renderPopularTopics();
    renderLists();
    // Scroll to the latest section
    const latestSection = document.getElementById("latest");
    if (latestSection) {
      latestSection.scrollIntoView({ behavior: "smooth" });
    }
  });
}

function hydrateCounts() {
  const commentCounts = {};
  state.comments.forEach((comment) => {
    commentCounts[comment.post_id] = (commentCounts[comment.post_id] || 0) + 1;
  });
  state.commentCounts = commentCounts;

  const likeCounts = {};
  const userLikes = new Set();
  state.likes.forEach((like) => {
    likeCounts[like.post_id] = (likeCounts[like.post_id] || 0) + 1;
    if (state.user && like.user_id === state.user.id) {
      userLikes.add(like.post_id);
    }
  });
  state.likeCounts = likeCounts;
  state.userLikes = userLikes;
}

function showLoadingPlaceholders() {
  const placeholders = [
    { id: "trendingList", message: "Loading trending posts..." },
    { id: "popularTrack", message: "Preparing popular posts..." },
    { id: "popularTopicsTrack", message: "Gathering discussions..." },
    { id: "categoryGrid", message: "Loading forum boards..." },
    { id: "latestPosts", message: "Loading latest posts..." },
    { id: "hotList", message: "Identifying highlights..." },
    { id: "leaderboardList", message: "Updating leaderboard..." },
    { id: "statsList", message: "Syncing stats..." }
  ];
  placeholders.forEach(({ id, message }) => {
    const element = document.getElementById(id);
    if (element) {
      element.innerHTML = `<div class="callout">${escapeHTML(message)}</div>`;
    }
  });
}

function getPostScore(post) {
  const likes = state.likeCounts[post.id] || 0;
  return likes * 2 + (post.views || 0);
}

function renderStats() {
  const statsList = document.getElementById("statsList");
  if (!statsList) return;
  const totalLikes = state.likes.length;
  statsList.innerHTML = [
    { label: "Total Posts", value: state.posts.length },
    { label: "Replies", value: state.comments.length },
    { label: "Reactions", value: totalLikes },
    { label: "Categories", value: state.categories.length }
  ]
    .map(
      (stat) =>
        `<div class="stats-item"><span>${escapeHTML(stat.label)}</span><strong>${stat.value}</strong></div>`
    )
    .join("");
}

function buildPostCard(post, compact = false) {
  const category = state.categories.find((cat) => cat.id === post.category_id);
  const categoryName = category ? category.name : "General";
  const commentCount = state.commentCounts[post.id] || 0;
  const likeCount = state.likeCounts[post.id] || 0;
  const liked = state.userLikes.has(post.id);
  const likeLabel = liked ? "Liked" : "Like";
  const tags = normalizeTags(post.tags)
    .slice(0, 3)
    .map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`)
    .join("");
  const publishedAt = post.publish_at || post.created_at;
  const title = compact ? clampText(post.title || "", 60) : post.title || "";
  const excerptText = clampText(stripHTML(post.content || ""), 140);
  const excerpt = compact ? "" : `<div>${escapeHTML(excerptText)}</div>`;
  const pin = post.pinned ? `<span class="chip">Popular</span>` : "";

  return `
    <article class="post-card" data-reveal>
      <div class="post-meta">
        <span>${escapeHTML(categoryName)}</span>
        <span>${timeAgo(publishedAt)}</span>
        <span>${readingTime(post.content || "")}</span>
        ${pin}
      </div>
      <a href="post.html?id=${post.id}"><h3>${escapeHTML(title)}</h3></a>
      ${excerpt}
      <div class="tag-list">${tags}</div>
      <div class="post-actions">
        <span>${commentCount} replies</span>
        <span data-like-count="${post.id}">${likeCount} likes</span>
        <span>${post.views || 0} views</span>
      </div>
      <div class="post-action-buttons">
        <button class="post-action-btn${liked ? " active" : ""}" data-action="like" data-id="${post.id}" data-like-button="${post.id}">
          <span data-like-label="${post.id}">${likeLabel}</span>
          <strong data-like-count-inline="${post.id}">${likeCount}</strong>
        </button>
        <a class="post-action-btn" data-action="comment" href="post.html?id=${post.id}#comments">
          Comment <strong>${commentCount}</strong>
        </a>
        <button class="post-action-btn" data-action="share" data-id="${post.id}">Share</button>
      </div>
    </article>
  `;
}

function renderTrending() {
  const target = document.getElementById("trendingList");
  if (!target) return;
  const sourcePosts = state.filteredPosts || state.posts;
  const categoryFiltered = state.activeCategory === "all" 
    ? sourcePosts 
    : sourcePosts.filter((post) => post.category_id === state.activeCategory);
  const sorted = [...categoryFiltered]
    .sort((a, b) => getPostScore(b) - getPostScore(a))
    .slice(0, 3);
  if (!sorted.length) {
    target.innerHTML = "<div class=\"callout\">No trending posts yet — be the first to post.</div>";
    return;
  }
  target.innerHTML = sorted.map((post) => buildPostCard(post, true)).join("");
  setupReveal(target);
}

function renderPopular() {
  const track = document.getElementById("popularTrack");
  if (!track) return;
  const sourcePosts = state.filteredPosts || state.posts;
  const categoryFiltered = state.activeCategory === "all" 
    ? sourcePosts 
    : sourcePosts.filter((post) => post.category_id === state.activeCategory);
  const withCover = categoryFiltered.filter((post) => !!post.cover);
  const pinned = withCover
    .filter((post) => post.pinned)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  const scored = withCover
    .filter((post) => !post.pinned)
    .sort((a, b) => getPostScore(b) - getPostScore(a));
  const topPosts = [...pinned, ...scored].slice(0, 5);
  if (!topPosts.length) {
    track.innerHTML = "<div class=\"callout\">No popular posts yet — be the first to post.</div>";
    return;
  }

  track.innerHTML = topPosts
    .map((post) => {
      const summary = clampText(stripHTML(post.content || ""), 140);
      const category = state.categories.find((cat) => cat.id === post.category_id);
      const categoryName = category ? category.name : "General";
      const likes = state.likeCounts[post.id] || 0;
      const comments = state.commentCounts[post.id] || 0;
      const liked = state.userLikes.has(post.id);
      const likeLabel = liked ? "Liked" : "Like";
      return `
        <article class="popular-card" data-reveal>
          <a class="popular-media" href="post.html?id=${post.id}">
            ${post.cover && isSafeUrl(post.cover) ? `<img src="${escapeHTML(post.cover)}" alt="${escapeHTML(post.title || "Post cover")}">` : ""}
          </a>
          <div class="popular-body">
            <div class="popular-meta">
              <span>${escapeHTML(categoryName)}</span>
              <span data-like-count="${post.id}">${likes} likes</span>
              <span>${comments} replies</span>
            </div>
            <a href="post.html?id=${post.id}">
              <h3>${escapeHTML(post.title || "")}</h3>
            </a>
            <div class="popular-summary">${escapeHTML(summary)}</div>
            <div class="popular-actions">
              <button class="post-action-btn${liked ? " active" : ""}" data-action="like" data-id="${post.id}" data-like-button="${post.id}">
                <span data-like-label="${post.id}">${likeLabel}</span>
                <strong data-like-count-inline="${post.id}">${likes}</strong>
              </button>
              <a class="post-action-btn" data-action="comment" href="post.html?id=${post.id}#comments">
                Comment <strong>${comments}</strong>
              </a>
              <button class="post-action-btn" data-action="share" data-id="${post.id}">Share</button>
            </div>
          </div>
        </article>
      `;
    })
    .join("");

  setupReveal(track);
  setupPopularNav();
}

function renderPopularTopics() {
  const track = document.getElementById("popularTopicsTrack");
  if (!track) return;
  if (!state.discussionTopics.length) {
    track.innerHTML = "<div class=\"callout\">No discussions yet — start the first one.</div>";
    return;
  }

  const messageCounts = {};
  state.discussionMessages.forEach((message) => {
    messageCounts[message.topic_id] = (messageCounts[message.topic_id] || 0) + 1;
  });

  const scored = [...state.discussionTopics].sort((a, b) => {
    const aScore = (messageCounts[a.id] || 0) * 2;
    const bScore = (messageCounts[b.id] || 0) * 2;
    if (aScore !== bScore) return bScore - aScore;
    return new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at);
  });

  const topTopics = scored.slice(0, 5);
  track.innerHTML = topTopics
    .map((topic) => {
      const count = messageCounts[topic.id] || 0;
      const mediaUrl = topic.media_url && isSafeUrl(topic.media_url) ? escapeHTML(topic.media_url) : "";
      const media =
        topic.media_type === "video" && mediaUrl
          ? `<video muted playsinline controls src="${mediaUrl}"></video>`
          : mediaUrl
            ? `<img src="${mediaUrl}" alt="${escapeHTML(topic.title || "Topic cover")}">`
            : "";
      return `
        <article class="popular-card topic-card" data-reveal>
          <a class="popular-media" href="discussion.html?topic=${topic.id}">
            ${media}
          </a>
          <div class="popular-body">
            <div class="popular-meta">
              <span>${count} replies</span>
              <span>${escapeHTML(topic.author_name || "Member")}</span>
              <span>${timeAgo(topic.created_at)}</span>
            </div>
            <a href="discussion.html?topic=${topic.id}">
              <h3>${escapeHTML(topic.title || "")}</h3>
            </a>
            <div class="popular-summary">${escapeHTML(clampText(topic.description || "", 140))}</div>
          </div>
        </article>
      `;
    })
    .join("");

  setupReveal(track);
  setupTopicNav();
}

function renderCategories() {
  const grid = document.getElementById("categoryGrid");
  if (!grid) return;
  if (!state.categories.length) {
    grid.innerHTML = "<div class=\"callout\">No categories yet — add the first board.</div>";
    return;
  }
  grid.innerHTML = state.categories
    .map((cat) => {
      const postCount = state.posts.filter((post) => post.category_id === cat.id).length;
      return `
        <div class="category-card" data-reveal style="border-left: 4px solid ${cat.color};">
          <h3>${escapeHTML(cat.name)}</h3>
          <div>${escapeHTML(cat.description || "")}</div>
          <div class="category-meta"><span>${postCount} topics</span><span>Join the talk</span></div>
        </div>
      `;
    })
    .join("");
  setupReveal(grid);
}

function renderLists() {
  const latestTarget = document.getElementById("latestPosts");
  const hotTarget = document.getElementById("hotList");
  if (!latestTarget || !hotTarget) return;

  const query = state.searchTerm.toLowerCase();
  const sourcePosts = state.filteredPosts || state.posts;
  const filtered = sourcePosts
    .filter((post) =>
      state.activeCategory === "all" ? true : post.category_id === state.activeCategory
    )
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return new Date(b.created_at) - new Date(a.created_at);
    });

  latestTarget.innerHTML = filtered.map((post) => buildPostCard(post, false)).join("");
  if (!filtered.length) {
    if (state.searchTerm || state.activeTags.length) {
      latestTarget.innerHTML = `
        <div class="callout">
          No results yet. Be the first to post about "${escapeHTML(state.searchTerm || state.activeTags.join(", "))}".
          <div style="margin-top:10px;">
            <button class="btn ghost" id="requestContentBtn" type="button">Request this topic</button>
          </div>
        </div>
      `;
      const requestBtn = document.getElementById("requestContentBtn");
      if (requestBtn) {
        requestBtn.addEventListener("click", handleContentRequest);
      }
    } else {
      latestTarget.innerHTML = "<div class=\"callout\">No posts yet — be the first to post.</div>";
    }
  }
  setupReveal(latestTarget);

  const hotPosts = state.filteredPosts || state.posts;
  const hotCategoryFiltered = state.activeCategory === "all" 
    ? hotPosts 
    : hotPosts.filter((post) => post.category_id === state.activeCategory);
  const hotList = [...hotCategoryFiltered].sort((a, b) => getPostScore(b) - getPostScore(a)).slice(0, 4);
  hotTarget.innerHTML = hotList.map((post) => buildPostCard(post, true)).join("");
  if (!hotList.length) {
    hotTarget.innerHTML = "<div class=\"callout\">No highlights yet — spark the first one.</div>";
  }
  setupReveal(hotTarget);
}

function updateLikeDisplays(postId) {
  const likeCount = state.likeCounts[postId] || 0;
  const liked = state.userLikes.has(postId);
  document.querySelectorAll(`[data-like-count="${postId}"]`).forEach((el) => {
    el.textContent = `${likeCount} likes`;
  });
  document.querySelectorAll(`[data-like-count-inline="${postId}"]`).forEach((el) => {
    el.textContent = likeCount;
  });
  document.querySelectorAll(`[data-like-button="${postId}"]`).forEach((btn) => {
    btn.classList.toggle("active", liked);
  });
  document.querySelectorAll(`[data-like-label="${postId}"]`).forEach((el) => {
    el.textContent = liked ? "Liked" : "Like";
  });
}

function requireAuthForAction(action) {
  if (state.user) return true;
  alert(`Please log in to ${action} posts.`);
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  window.location.href = `login.html?next=${next}`;
  return false;
}

function buildShareUrl(postId) {
  const origin = window.location.origin === "null" ? "" : window.location.origin;
  const basePath = window.location.pathname.replace(/[^/]*$/, "");
  const path = `${basePath}post.html?id=${postId}`;
  return origin ? `${origin}${path}` : `post.html?id=${postId}`;
}

async function recordShare(postId, channel) {
  if (!state.user) return;
  await createPostShare({
    id: crypto.randomUUID(),
    post_id: postId,
    user_id: state.user.id,
    channel,
    created_at: new Date().toISOString()
  });
}

function setupPostActionButtons() {
  if (setupPostActionButtons.ready) return;
  document.addEventListener("click", async (event) => {
    const button = event.target.closest(".post-action-btn");
    if (!button) return;
    const action = button.dataset.action;
    const postId = button.dataset.id;
    if (!action || !postId) return;
    if (action === "comment") return;

    if (action === "like") {
      if (!requireAuthForAction("like")) return;
      const result = await togglePostLike(postId, state.user.id);
      if (result.liked) {
        state.userLikes.add(postId);
        state.likeCounts[postId] = (state.likeCounts[postId] || 0) + 1;
      } else {
        state.userLikes.delete(postId);
        state.likeCounts[postId] = Math.max(0, (state.likeCounts[postId] || 1) - 1);
      }
      updateLikeDisplays(postId);
      return;
    }

    if (action === "share") {
      if (!requireAuthForAction("share")) return;
      const post = state.posts.find((item) => item.id === postId);
      const shareUrl = buildShareUrl(postId);
      if (navigator.share) {
        try {
          await navigator.share({
            title: post?.title || "Timzee Tech Hub",
            text: "Check this out",
            url: shareUrl
          });
          await recordShare(postId, "share");
        } catch (error) {
          console.warn("Share canceled", error);
        }
      } else {
        try {
          await navigator.clipboard.writeText(shareUrl);
          await recordShare(postId, "copy");
          const label = button.textContent;
          button.textContent = "Copied";
          setTimeout(() => {
            button.textContent = label;
          }, 1500);
        } catch (error) {
          prompt("Copy this link:", shareUrl);
        }
      }
    }
  });
  setupPostActionButtons.ready = true;
}

function setupPopularNav() {
  const track = document.getElementById("popularTrack");
  const prevBtn = document.getElementById("popularPrev");
  const nextBtn = document.getElementById("popularNext");
  if (!track || !prevBtn || !nextBtn) return;

  const updateState = () => {
    const maxScroll = track.scrollWidth - track.clientWidth;
    const hasOverflow = maxScroll > 4;
    prevBtn.style.display = hasOverflow ? "inline-flex" : "none";
    nextBtn.style.display = hasOverflow ? "inline-flex" : "none";
    prevBtn.disabled = track.scrollLeft <= 2;
    nextBtn.disabled = track.scrollLeft >= maxScroll - 2;
  };

  if (!track.dataset.navReady) {
    prevBtn.addEventListener("click", () => {
      track.scrollBy({ left: -track.clientWidth * 0.85, behavior: "smooth" });
    });
    nextBtn.addEventListener("click", () => {
      track.scrollBy({ left: track.clientWidth * 0.85, behavior: "smooth" });
    });
    track.addEventListener("scroll", updateState);
    window.addEventListener("resize", updateState);
    track.dataset.navReady = "true";
  }
  updateState();
}

function setupTopicNav() {
  const track = document.getElementById("popularTopicsTrack");
  const prevBtn = document.getElementById("topicPrev");
  const nextBtn = document.getElementById("topicNext");
  if (!track || !prevBtn || !nextBtn) return;

  const updateState = () => {
    const maxScroll = track.scrollWidth - track.clientWidth;
    const hasOverflow = maxScroll > 4;
    prevBtn.style.display = hasOverflow ? "inline-flex" : "none";
    nextBtn.style.display = hasOverflow ? "inline-flex" : "none";
    prevBtn.disabled = track.scrollLeft <= 2;
    nextBtn.disabled = track.scrollLeft >= maxScroll - 2;
  };

  if (!track.dataset.navReady) {
    prevBtn.addEventListener("click", () => {
      track.scrollBy({ left: -track.clientWidth * 0.85, behavior: "smooth" });
    });
    nextBtn.addEventListener("click", () => {
      track.scrollBy({ left: track.clientWidth * 0.85, behavior: "smooth" });
    });
    track.addEventListener("scroll", updateState);
    window.addEventListener("resize", updateState);
    track.dataset.navReady = "true";
  }
  updateState();
}

function setupSearch() {
  const input = document.getElementById("searchInput");
  if (!input) return;
  let timer = null;
  
  input.addEventListener("input", (event) => {
    state.searchTerm = (event.target.value || "").trim();
    if (timer) clearTimeout(timer);
    
    // Immediately show results for short delays
    if (state.searchTerm.length >= 2) {
      timer = setTimeout(() => {
        performSearch();
      }, 250);
    } else if (state.searchTerm.length === 0) {
      // Clear search immediately
      performSearch();
    }
  });
  
  // Also bind to the search go button if it exists (support span or the new button)
  const goBtn = document.querySelector(".search-box span") || document.getElementById("searchBtn");
  if (goBtn) {
    goBtn.addEventListener("click", performSearch);
  }
}

function collectTags(posts) {
  const tagSet = new Set();
  posts.forEach((post) => {
    normalizeTags(post.tags).forEach((tag) => tagSet.add(tag));
  });
  return Array.from(tagSet).sort((a, b) => a.localeCompare(b));
}

function renderTagFilters() {
  const select = document.getElementById("tagFilter");
  if (!select) return;
  const tags = collectTags(state.posts);
  select.innerHTML = `
    <option value="">All tags</option>
    ${tags.map((tag) => `<option value="${escapeHTML(tag)}">${escapeHTML(tag)}</option>`).join("")}
  `;
}

function setupTagFilters() {
  const select = document.getElementById("tagFilter");
  const clearBtn = document.getElementById("tagClearBtn");
  if (select) {
    select.addEventListener("change", () => {
      const value = select.value || "";
      state.activeTags = value ? [value] : [];
      performSearch();
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener("click", () => {
      state.activeTags = [];
      if (select) select.value = "";
      if (state.searchTerm) {
        const input = document.getElementById("searchInput");
        if (input) input.value = "";
        state.searchTerm = "";
      }
      state.filteredPosts = null;
      renderTrending();
      renderPopular();
      renderPopularTopics();
      renderLists();
    });
  }
}

async function performSearch() {
  if (!state.searchTerm && !state.activeTags.length) {
    state.filteredPosts = null;
    renderTrending();
    renderPopular();
    renderPopularTopics();
    renderLists();
    return;
  }
  
  try {
    const results = await searchPosts({
      query: state.searchTerm,
      tags: state.activeTags
    });
    
    if (results && Array.isArray(results)) {
      state.filteredPosts = results;
    } else {
      state.filteredPosts = [];
    }
    
    renderTrending();
    renderPopular();
    renderPopularTopics();
    renderLists();
  } catch (error) {
    console.error("Search error:", error);
    state.filteredPosts = [];
    renderTrending();
    renderPopular();
    renderPopularTopics();
    renderLists();
  }
}

async function handleContentRequest() {
  const topic = state.searchTerm || state.activeTags.join(", ");
  if (!topic) return;
  let email = "";
  if (!state.user) {
    email = prompt("Enter your email so we can notify you (optional):") || "";
  }
  const payload = {
    id: crypto.randomUUID(),
    user_id: state.user?.id || null,
    user_email: state.user?.email || email || "",
    user_name: state.user ? getDisplayName(state.user) : "",
    query: topic,
    status: "open",
    created_at: new Date().toISOString()
  };
  const result = await createContentRequest(payload);
  if (result.error) {
    alert(result.error.message || "Request failed. Please try again.");
    return;
  }
  alert("Request sent to the admins. Thanks!");
}

function renderLeaderboard() {
  const list = document.getElementById("leaderboardList");
  if (!list) return;
  if (!state.leaderboard.length) {
    list.innerHTML = "<div class=\"callout\">No member rankings yet.</div>";
    return;
  }
  list.innerHTML = state.leaderboard
    .map((profile) => {
      const name = profile.display_name || profile.username || "Member";
      const defaultAvatar = "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80";
      const avatar = isSafeUrl(profile.avatar_url) ? profile.avatar_url : defaultAvatar;
      const points = profile.points || 0;
      const level = profile.level || deriveLevel(points).label;
      const verified = profile.is_verified ? `<span class="verified-badge small">✓</span>` : "";
      return `
        <div class="leaderboard-item">
          <img src="${avatar}" alt="member avatar">
          <div>
            <div><strong>${escapeHTML(name)}</strong>${verified}</div>
            <div class="leaderboard-meta">
              <span>${points} pts</span>
              <span>${escapeHTML(level)}</span>
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

function isAdActive(ad) {
  if (!ad) return false;
  if (ad.status && ad.status !== "active") return false;
  const now = new Date();
  if (ad.starts_at && new Date(ad.starts_at) > now) return false;
  if (ad.ends_at && new Date(ad.ends_at) < now) return false;
  return true;
}

function buildAdCard(ad) {
  if (!ad) return "";
  const image = ad.image_url && isSafeUrl(ad.image_url) ? `<img src="${escapeHTML(ad.image_url)}" alt="${escapeHTML(ad.title || "Ad image")}">` : "";
  const safeLink = isSafeUrl(ad.link_url) ? escapeHTML(ad.link_url) : "#";
  return `
    <div class="ad-card">
      <div class="ad-label">Sponsored</div>
      ${image}
      <strong>${escapeHTML(ad.title || "")}</strong>
      <p>${escapeHTML(ad.body || "")}</p>
      <a class="btn ghost" href="${safeLink}" target="_blank" rel="noopener">Visit</a>
    </div>
  `;
}

function renderCustomAds(target, ads, limit = 1) {
  if (!target) return false;
  const activeAds = ads.filter(isAdActive).slice(0, limit);
  if (!activeAds.length) return false;
  target.innerHTML = activeAds.map((ad) => buildAdCard(ad)).join("");
  return true;
}

function renderAds(settings) {
  const homeTop = document.getElementById("homeTopAd");
  const homeSidebar = document.getElementById("homeSidebarAd");
  if (!homeTop || !homeSidebar) return;

  const homeTopAds = state.ads.filter(
    (ad) => ad.placement === "home_top" || ad.placement === "global"
  );
  const homeSidebarAds = state.ads.filter(
    (ad) => ad.placement === "home_sidebar" || ad.placement === "global"
  );

  const filledTop = renderCustomAds(homeTop, homeTopAds, 1);
  const filledSidebar = renderCustomAds(homeSidebar, homeSidebarAds, 1);

  if (!settings.adSense.enabled || !settings.adSense.publisherId) {
    return;
  }

  const buildAd = (slotId) => {
    if (!slotId) return "<div class=\"ad-slot\">Ad slot not configured</div>";
    return `
      <ins class="adsbygoogle"
        style="display:block"
        data-ad-client="${settings.adSense.publisherId}"
        data-ad-slot="${slotId}"
        data-ad-format="auto"
        data-full-width-responsive="true"></ins>
    `;
  };

  let usedAdsense = false;
  if (!filledTop) {
    homeTop.innerHTML = buildAd(settings.adSense.slots.homeTop);
    usedAdsense = true;
  }
  if (!filledSidebar) {
    homeSidebar.innerHTML = buildAd(settings.adSense.slots.homeSidebar);
    usedAdsense = true;
  }

  if (usedAdsense && !document.getElementById("adsbygoogle-script")) {
    const script = document.createElement("script");
    script.id = "adsbygoogle-script";
    script.async = true;
    script.src = "https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js";
    document.body.appendChild(script);
    script.onload = () => {
      try {
        (window.adsbygoogle = window.adsbygoogle || []).push({});
      } catch (error) {
        console.warn("Adsense init skipped", error);
      }
    };
  }
}

async function boot() {
  showLoadingPlaceholders();
  state.user = await getCurrentUserWithRole();
  state.settings = await fetchSettings();
  applyTheme(state.settings);
  if (state.settings.themeId) {
    const theme = await fetchThemeById(state.settings.themeId);
    if (theme) applyThemeVariables(theme);
  }

  const [categories, posts, comments, likes, ads, discussionTopics, discussionMessages, leaderboard] = await Promise.all([
    fetchCategories(),
    fetchPosts({ status: "published" }),
    fetchComments({ status: "approved" }),
    fetchPostLikes(),
    fetchAds({ status: "active" }),
    fetchDiscussionTopics(),
    fetchDiscussionMessages(),
    fetchTopProfiles(5)
  ]);

  state.categories = categories;
  state.posts = posts;
  state.comments = comments;
  state.likes = likes;
  state.ads = ads;
  state.discussionTopics = discussionTopics;
  state.discussionMessages = discussionMessages;
  state.leaderboard = leaderboard;
  hydrateCounts();

  renderAuthActions();
  showAdminLinks();
  renderNav(state.categories);
  renderStats();
  renderTrending();
  renderPopular();
  renderPopularTopics();
  renderCategories();
  renderLists();
  renderTagFilters();
  setupTagFilters();
  renderLeaderboard();
  renderAds(state.settings);
  setupSearch();
  setupPostActionButtons();
  setupReveal();
}

boot();
