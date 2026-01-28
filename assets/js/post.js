import {
  fetchCategories,
  fetchPosts,
  fetchComments,
  fetchPostLikes,
  fetchPostByIdOrSlug,
  fetchPostMedia,
  fetchAds,
  createComment,
  togglePostLike,
  toggleBookmark,
  fetchBookmarkStatus,
  toggleFollow,
  fetchFollowStatus,
  createNotification,
  incrementProfilePoints,
  fetchProfilesByUsernames,
  fetchProfilesByIds,
  incrementPostViews
} from "./data.js";
import { setupMentionInput, extractMentions, getMentionedUserIds } from "./mentions.js";
import { uploadMedia } from "./media.js";
import { fetchSettings } from "./settings.js";
import { fetchThemeById, applyThemeVariables } from "./themes.js";
import { supabase, SITE_URL, getCurrentUser, getCurrentUserWithRole, getDisplayName, getUserRole, signOut } from "./supabase.js";
import {
  formatDate,
  timeAgo,
  readingTime,
  getQueryParam,
  clampText,
  escapeHTML,
  stripHTML,
  normalizeTags,
  extractMentions,
  linkifyReferences
} from "./utils.js";
import { setupReveal } from "./reveal.js";
import "./nav.js";

const state = {
  user: null,
  settings: null,
  categories: [],
  likes: [],
  likeCount: 0,
  hasLiked: false,
  ads: [],
  postMedia: [],
  authorProfile: null,
  authorPostCount: 0,
  isBookmarked: false,
  isFollowingAuthor: false,
  commentAuthors: {},
  commentIndex: {}
};

let commentReplyTo = null;

const FALLBACK_OG_IMAGE =
  "https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=1200&q=80";

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
  if (siteName) siteName.innerHTML = formatBrandName(settings.siteName);
  if (siteTagline) siteTagline.textContent = settings.tagline;
}

function updateMeta(post) {
  if (!post) return;
  const title = post.title ? `${post.title} - Timzee Tech Hub` : "Post - Timzee Tech Hub";
  document.title = title;
  const excerpt = clampText(stripHTML(post.content || ""), 160);
  const description = excerpt || "Read the latest post on Timzee Tech Hub.";
  const base = SITE_URL || window.location.origin || "";
  const url = post.id ? `${base}/post.html?id=${post.id}` : `${base}/post.html`;
  const image = post.cover || FALLBACK_OG_IMAGE;
  const tagList = normalizeTags(post.tags).slice(0, 10);
  const keywords = [
    "Timzee Tech Hub",
    "tech blog",
    "tech news",
    ...tagList
  ]
    .filter(Boolean)
    .join(", ");

  const setMeta = (id, value) => {
    const el = document.getElementById(id);
    if (el && value) el.setAttribute("content", value);
  };
  const setLink = (id, value) => {
    const el = document.getElementById(id);
    if (el && value) el.setAttribute("href", value);
  };

  setMeta("metaDescription", description);
  setMeta("ogTitle", title);
  setMeta("ogDescription", description);
  setMeta("ogUrl", url);
  setMeta("ogImage", image);
  setMeta("twitterTitle", title);
  setMeta("twitterDescription", description);
  setMeta("twitterImage", image);
  setLink("canonicalLink", url);
  const keywordMeta = document.querySelector('meta[name="keywords"]');
  if (keywordMeta && keywords) {
    keywordMeta.setAttribute("content", keywords);
  }

  const schema = document.getElementById("postSchema");
  if (schema) {
    const publishedAt = post.publish_at || post.created_at || new Date().toISOString();
    const payload = {
      "@context": "https://schema.org",
      "@type": "BlogPosting",
      headline: post.title || "Post",
      description,
      image: image ? [image] : [],
      datePublished: publishedAt,
      dateModified: post.updated_at || publishedAt,
      author: {
        "@type": "Person",
        name: post.author_name || "Timzee Tech Hub"
      },
      publisher: {
        "@type": "Organization",
        name: "Timzee Tech Hub",
        url: SITE_URL || base
      },
      mainEntityOfPage: {
        "@type": "WebPage",
        "@id": url
      }
    };
    schema.textContent = JSON.stringify(payload);
  }
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
    profile.href = `profile.html?id=${state.user.id}`;
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

function renderPost(data, post) {
  const category = data.categories.find((cat) => cat.id === post.category_id);
  document.getElementById("postCategory").textContent = category ? category.name : "General";
  document.getElementById("postTitle").textContent = post.title || "";
  const postDate = document.getElementById("postDate");
  const publishedAt = post.publish_at || post.created_at;
  if (postDate) postDate.textContent = formatDate(publishedAt);
  const postDek = document.getElementById("postDek");
  if (postDek) {
    const snippet = clampText(stripHTML(post.content || ""), 160);
    postDek.textContent = snippet;
  }
  document.getElementById("postMeta").innerHTML = `
    <span>By ${escapeHTML(post.author_name || "Editor")}</span>
    <span>${formatDate(publishedAt)}</span>
    <span>${readingTime(post.content || "")}</span>
  `;

  const cover = document.getElementById("postCover");
  cover.innerHTML = post.cover ? `<img src="${post.cover}" alt="${escapeHTML(post.title || "Post cover")}">` : "";
  document.getElementById("postContent").innerHTML = post.content || "";

  const gallery = document.getElementById("postGallery");
  if (gallery) {
    gallery.innerHTML = "";
  }

  const tags = document.getElementById("postTags");
  tags.innerHTML = normalizeTags(post.tags)
    .map((tag) => `<span class="tag">${escapeHTML(tag)}</span>`)
    .join("");

  updateCounts(post);
}

function buildTakeaways(post) {
  const text = stripHTML(post.content || "");
  const sentences = text
    .split(/[.!?]\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 30);
  if (sentences.length) return sentences.slice(0, 3);
  const tags = normalizeTags(post.tags);
  if (!tags.length) return [];
  return tags.slice(0, 3).map((tag) => `Tagged with ${tag}.`);
}

function renderTakeaways(post) {
  const list = document.getElementById("postTakeaways");
  if (!list) return;
  const items = buildTakeaways(post);
  if (!items.length) {
    list.innerHTML = "";
    list.parentElement?.classList.add("hidden");
    return;
  }
  list.parentElement?.classList.remove("hidden");
  list.innerHTML = items.map((item) => `<li>${escapeHTML(item)}</li>`).join("");
}

function buildAuthorBadges(profile) {
  if (!profile) return "";
  const badges = [];
  if (profile.is_featured) badges.push('<span class="badge-chip featured">Featured</span>');
  if (profile.is_staff_pick) badges.push('<span class="badge-chip staff">Staff Pick</span>');
  if (!badges.length) return "";
  return `<div class="author-badges">${badges.join("")}</div>`;
}

function renderAuthorMini(post) {
  const wrap = document.getElementById("authorMini");
  if (!wrap) return;
  const profile = state.authorProfile;
  const name = profile?.display_name || post.author_name || "Editor";
  const role = profile?.headline || "Contributor";
  const badge = profile?.is_verified
    ? `<span class="verified-badge small" title="Verified">✓</span>`
    : "";
  const badgeSet = buildAuthorBadges(profile);
  const avatar =
    profile?.avatar_url ||
    "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80";
  const link = profile?.id ? `profile.html?id=${profile.id}` : "profile.html";
  const canFollow = state.user && profile?.id && profile.id !== state.user.id;
  const followBtn = canFollow
    ? `<button class="btn ghost" id="followAuthorBtn">${state.isFollowingAuthor ? "Following" : "Follow"}</button>`
    : `<a class="btn ghost" href="${link}">View profile</a>`;
  wrap.innerHTML = `
    <img src="${avatar}" alt="author avatar">
    <div>
      <div class="author-name">${escapeHTML(name)}${badge}</div>
      <div class="author-role">${escapeHTML(role)}</div>
      ${badgeSet}
    </div>
    ${followBtn}
  `;
}

function renderAuthorCard(post) {
  const card = document.getElementById("authorProfileCard");
  if (!card) return;
  const profile = state.authorProfile;
  const name = profile?.display_name || post.author_name || "Editor";
  const role = profile?.headline || "Contributor";
  const badge = profile?.is_verified
    ? `<span class="verified-badge small" title="Verified">✓</span>`
    : "";
  const badgeSet = buildAuthorBadges(profile);
  const bio =
    profile?.bio ||
    "Writes about tech, product design, and what to watch in the community this week.";
  const avatar =
    profile?.avatar_url ||
    "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?auto=format&fit=crop&w=200&q=80";
  const link = profile?.id ? `profile.html?id=${profile.id}` : "profile.html";
  const postsLabel = state.authorPostCount ? `${state.authorPostCount} posts` : "Featured author";
  card.innerHTML = `
    <div class="author-card">
      <img src="${avatar}" alt="author avatar">
      <div>
        <div class="author-name">${escapeHTML(name)}${badge}</div>
        <div class="author-role">${escapeHTML(role)}</div>
        ${badgeSet}
        <p>${escapeHTML(bio)}</p>
        <div class="author-meta">
          <span>${postsLabel}</span>
          <a class="btn ghost" href="${link}">View Profile</a>
        </div>
      </div>
    </div>
  `;
}

function renderGallery(mediaItems) {
  const gallery = document.getElementById("postGallery");
  if (!gallery) return;
  if (!mediaItems.length) {
    gallery.innerHTML = "";
    return;
  }
  gallery.innerHTML = mediaItems
    .map((item) => {
      if (item.media_type === "video") {
        return `<video controls src="${item.url}"></video>`;
      }
      return `<img src="${item.url}" alt="post media">`;
    })
    .join("");
}

function updateCounts(post) {
  document.getElementById("likeCount").textContent = `${state.likeCount} likes`;
  document.getElementById("viewCount").textContent = `${post.views || 0} views`;
}

async function incrementViewIfNeeded(post) {
  const viewKey = `techblog_viewed_${post.id}`;
  if (localStorage.getItem(viewKey)) return;
  const nextViews = await incrementPostViews(post.id, post.views || 0);
  post.views = nextViews;
  localStorage.setItem(viewKey, "1");
  updateCounts(post);
}

function renderRelated(data, post) {
  const related = data.posts
    .filter((item) => item.category_id === post.category_id && item.id !== post.id)
    .slice(0, 3);
  const target = document.getElementById("relatedPosts");
  if (!target) return;
  if (!related.length) {
    target.innerHTML = "<div class=\"callout\">No related posts yet — explore the homepage.</div>";
    return;
  }
  target.innerHTML = related
    .map(
      (item) => `
        <article class="post-card" data-reveal>
          <a href="post.html?id=${item.id}"><h4>${escapeHTML(clampText(item.title || "", 60))}</h4></a>
          <div class="post-meta"><span>${timeAgo(item.created_at)}</span><span>${item.views || 0} views</span></div>
        </article>
      `
    )
    .join("");
  setupReveal(target);
}

function renderComments(comments) {
  const list = document.getElementById("commentList");
  if (!list) return;
  if (!comments.length) {
    list.innerHTML = "<div class=\"callout\">No comments yet — be the first to reply.</div>";
    return;
  }
  const byId = new Map(comments.map((comment) => [comment.id, comment]));
  state.commentIndex = Object.fromEntries(byId);
  list.innerHTML = comments
    .map((comment) => {
      const safeBody = linkifyReferences(stripHTML(comment.body || "")).replace(/\n/g, "<br>");
      const authorProfile = state.commentAuthors[comment.author_id];
      const mentionHandle = authorProfile?.username || "";
      const replyTarget = comment.reply_to ? byId.get(comment.reply_to) : null;
      const replySnippet = replyTarget
        ? `<div class="callout">Replying to ${escapeHTML(
            replyTarget.author_name || "Member"
          )}: ${escapeHTML(clampText(stripHTML(replyTarget.body || ""), 90))}</div>`
        : "";
      const replyButton = mentionHandle
        ? `<button type="button" class="btn ghost small reply-comment-btn" data-id="${comment.id}" data-mention="@${escapeHTML(
            mentionHandle
          )}">Reply</button>`
        : "";
      return `
        <div class="comment-card" data-reveal id="comment-${comment.id}">
          <div class="comment-meta"><span>${
            comment.author_id
              ? `<a href="profile.html?id=${comment.author_id}">${escapeHTML(
                  comment.author_name || "Member"
                )}</a>`
              : escapeHTML(comment.author_name || "Member")
          }</span><span>${timeAgo(comment.created_at)}</span></div>
          ${replySnippet}
          <div>${safeBody}</div>
          ${
            comment.image
              ? `<img src="${comment.image}" alt="comment image" style="border-radius:12px; max-height:200px;">`
              : ""
        }
        ${replyButton ? `<div class="comment-actions">${replyButton}</div>` : ""}
      </div>
    `;
  })
  .join("");
  setupReveal(list);
  bindCommentReplyButtons();
}

const MENTION_REGEX = /@([a-z0-9_]+)/gi;

function bindCommentReplyButtons() {
  const list = document.getElementById("commentList");
  const input = document.getElementById("commentBody");
  const preview = document.getElementById("commentReplyPreview");
  if (!list || !input) return;
  list.querySelectorAll(".reply-comment-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mention = btn.dataset.mention;
      const comment = state.commentIndex[btn.dataset.id];
      if (!mention) return;
      const trimmed = input.value.trim();
      const prefix = `${mention} `;
      input.value = trimmed.startsWith(prefix) ? trimmed : `${prefix}${trimmed}`;
      if (comment) {
        commentReplyTo = comment;
        if (preview) {
          preview.classList.remove("hidden");
          preview.innerHTML = `
            <span>Replying to ${escapeHTML(comment.author_name || "Member")}:</span>
            <span>${escapeHTML(clampText(stripHTML(comment.body || ""), 90))}</span>
            <button type="button" class="btn ghost" id="cancelCommentReply">Cancel</button>
          `;
          const cancel = document.getElementById("cancelCommentReply");
          if (cancel) {
            cancel.addEventListener("click", () => {
              commentReplyTo = null;
              preview.classList.add("hidden");
              preview.innerHTML = "";
            });
          }
        }
      }
      input.focus();
    });
  });
}

function extractMentionUsernames(text) {
  if (!text) return [];
  const matches = text.matchAll(MENTION_REGEX);
  const usernames = new Set();
  for (const match of matches) {
    if (match[1]) {
      usernames.add(match[1].toLowerCase());
    }
  }
  return Array.from(usernames);
}

async function notifyMentionTargets(usernames, post, commentId) {
  if (!state.user || !post || !usernames.length) return;
  const normalized = usernames.map((name) => name.toLowerCase());
  const targets = await fetchProfilesByUsernames(normalized);
  if (!targets.length) return;
  const postUrl = SITE_URL ? `${SITE_URL}/post.html?id=${post.id}` : `post.html?id=${post.id}`;
  const link = commentId ? `${postUrl}#comment-${commentId}` : `${postUrl}#comments`;
  await Promise.all(
    targets
      .filter((profile) => profile.id && profile.id !== state.user.id && profile.notify_mentions !== false)
      .map((profile) =>
        createNotification({
          id: crypto.randomUUID(),
          user_id: profile.id,
          type: "mention",
          title: `${getDisplayName(state.user)} mentioned you`,
          body: `${getDisplayName(state.user)} mentioned you in "${post.title || "a post"}".`,
          link,
          created_at: new Date().toISOString()
        })
      )
  );
}

async function loadCommentAuthors(comments) {
  const ids = Array.from(
    new Set(comments.map((comment) => comment.author_id).filter(Boolean))
  );
  if (!ids.length) {
    state.commentAuthors = {};
    return;
  }
  const profiles = await fetchProfilesByIds(ids);
  const map = {};
  profiles.forEach((profile) => {
    if (profile?.id) {
      map[profile.id] = profile;
    }
  });
  state.commentAuthors = map;
}

function setupLike(post) {
  const likeBtn = document.getElementById("likePostBtn");
  if (!likeBtn) return;
  const updateLabel = () => {
    likeBtn.textContent = state.hasLiked ? "Liked" : "Like";
  };
  updateLabel();
  likeBtn.addEventListener("click", async () => {
    if (!state.user) {
      alert("Please log in to like posts.");
      window.location.href = `login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    const result = await togglePostLike(post.id, state.user.id);
    state.hasLiked = result.liked;
    if (result.liked) {
      state.likeCount += 1;
    } else {
      state.likeCount = Math.max(0, state.likeCount - 1);
    }
    updateLabel();
    updateCounts(post);
  });
}

function setupShare(post) {
  const shareBtn = document.getElementById("shareBtn");
  const copyBtn = document.getElementById("copyLinkBtn");
  const origin = window.location.origin === "null" ? "" : window.location.origin;
  const basePath = window.location.href.split("?")[0];
  const shareUrl = `${origin ? origin + window.location.pathname : basePath}?id=${post.id}`;

  const requireLogin = () => {
    if (!state.user) {
      alert("Please log in to share posts.");
      window.location.href = `login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return false;
    }
    return true;
  };

  const recordShare = async (channel) => {
    if (!state.user) return;
    await supabase.from("post_shares").insert({
      id: crypto.randomUUID(),
      post_id: post.id,
      user_id: state.user.id,
      channel,
      created_at: new Date().toISOString()
    });
  };

  if (shareBtn) {
    shareBtn.addEventListener("click", async () => {
      if (!requireLogin()) return;
      if (navigator.share) {
        try {
          await navigator.share({
            title: post.title,
            text: "Check this out",
            url: shareUrl
          });
          await recordShare("share");
          if (state.user) {
            await incrementProfilePoints(state.user.id, 1);
          }
        } catch (error) {
          console.warn("Share canceled", error);
        }
      } else {
        alert("Sharing is not supported here. Use copy link instead.");
      }
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", async () => {
      if (!requireLogin()) return;
      try {
        await navigator.clipboard.writeText(shareUrl);
        copyBtn.textContent = "Copied";
        await recordShare("copy");
        if (state.user) {
          await incrementProfilePoints(state.user.id, 1);
        }
        setTimeout(() => {
          copyBtn.textContent = "Copy Link";
        }, 1500);
      } catch (error) {
        alert("Copy failed. Please copy the URL manually.");
      }
    });
  }
}

function setupBookmark(post) {
  const btn = document.getElementById("bookmarkBtn");
  if (!btn) return;
  const updateLabel = () => {
    btn.textContent = state.isBookmarked ? "Saved" : "Save";
    btn.classList.toggle("active", state.isBookmarked);
  };
  updateLabel();
  btn.addEventListener("click", async () => {
    if (!state.user) {
      alert("Please log in to save posts.");
      window.location.href = `login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    const result = await toggleBookmark(post.id, state.user.id);
    state.isBookmarked = result.saved;
    updateLabel();
  });
}

function setupFollowAuthor(post) {
  const btn = document.getElementById("followAuthorBtn");
  if (!btn) return;
  const updateLabel = () => {
    btn.textContent = state.isFollowingAuthor ? "Following" : "Follow";
  };
  updateLabel();
  btn.addEventListener("click", async () => {
    if (!state.user) {
      alert("Please log in to follow authors.");
      window.location.href = `login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
      return;
    }
    const result = await toggleFollow({
      targetType: "author",
      targetId: post.author_id,
      followerId: state.user.id
    });
    state.isFollowingAuthor = result.following;
    updateLabel();
    if (
      result.following &&
      post.author_id &&
      post.author_id !== state.user.id &&
      state.authorProfile?.notify_follows !== false
    ) {
      await createNotification({
        id: crypto.randomUUID(),
        user_id: post.author_id,
        type: "follow",
        title: "New follower",
        body: `${getDisplayName(state.user)} followed you.`,
        link: `profile.html?id=${state.user.id}`,
        created_at: new Date().toISOString()
      });
    }
  });
}

function setupCommentForm(post, comments) {
  const form = document.getElementById("commentForm");
  const imageInput = document.getElementById("commentImage");
  const preview = document.getElementById("commentPreview");
  const notice = document.getElementById("commentNotice");
  const commentAs = document.getElementById("commentAs");
  const submitBtn = form?.querySelector("button[type='submit']");
  const bodyInput = document.getElementById("commentBody");
  
  if (!form) return;

  if (!state.user) {
    if (commentAs) {
      commentAs.textContent = "Log in to join the discussion.";
      commentAs.style.display = "block";
    }
    if (submitBtn) submitBtn.textContent = "Log in to comment";
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      window.location.href = `login.html?next=${encodeURIComponent(window.location.pathname + window.location.search)}`;
    });
    return;
  }

  // Setup mention system on comment body
  if (bodyInput) {
    setupMentionInput(bodyInput);
  }

  if (commentAs) {
    commentAs.textContent = `Commenting as ${getDisplayName(state.user)}`;
    commentAs.style.display = "block";
  }

  if (imageInput) {
    imageInput.addEventListener("change", () => {
      const file = imageInput.files[0];
      if (!file) {
        preview.style.display = "none";
        preview.src = "";
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        preview.src = reader.result;
        preview.style.display = "block";
      };
      reader.readAsDataURL(file);
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = bodyInput?.value?.trim() || "";

    if (!body) {
      if (notice) {
        notice.textContent = "Please write a comment.";
        notice.style.display = "block";
        notice.style.color = "orange";
      }
      return;
    }

    // Show loading state
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = "Posting...";
    }
    if (notice) notice.style.display = "none";

    // Extract mentions for notification
    const mentionedUsernames = extractMentions(body);
    const mentionedUserIds = await getMentionedUserIds(body);
    const file = imageInput?.files?.[0];

    const commitComment = async (imageData = "") => {
      try {
        const status = state.settings?.features?.commentModeration ? "pending" : "approved";
        const safeBody = escapeHTML(body).replace(/\n/g, "<br>");
        const newComment = {
          id: crypto.randomUUID(),
          post_id: post.id,
          author_name: getDisplayName(state.user),
          author_id: state.user.id,
          reply_to: commentReplyTo?.id || null,
          body: safeBody,
          image: imageData || null,
          created_at: new Date().toISOString(),
          likes: 0,
          status,
          mentions: mentionedUserIds || []
        };
        
        const result = await createComment(newComment);
        if (result.error) {
          console.error("Comment creation error:", result.error);
          if (notice) {
            notice.textContent = `Error: ${result.error.message || "Comment failed. Please try again."}`;
            notice.style.display = "block";
            notice.style.color = "red";
          }
          return;
        }

        form.reset();
        if (preview) {
          preview.style.display = "none";
          preview.src = "";
        }
        
        const replyPreview = document.getElementById("commentReplyPreview");
        if (replyPreview) {
          replyPreview.classList.add("hidden");
          replyPreview.innerHTML = "";
        }

        if (commentReplyTo && commentReplyTo.author_id && commentReplyTo.author_id !== state.user.id) {
          await createNotification({
            id: crypto.randomUUID(),
            user_id: commentReplyTo.author_id,
            type: "reply",
            title: "New reply",
            body: `${getDisplayName(state.user)} replied to your comment.`,
            link: `post.html?id=${post.id}#comment-${result.data?.id || newComment.id}`,
            created_at: new Date().toISOString()
          });
        }

        // Notify mentioned users
        if (mentionedUserIds && mentionedUserIds.length > 0) {
          const uniqueMentions = [...new Set(mentionedUserIds)];
          for (const userId of uniqueMentions) {
            if (userId !== state.user.id) { // Don't notify self
              await createNotification({
                id: crypto.randomUUID(),
                user_id: userId,
                type: "mention",
                title: "You were mentioned",
                body: `${getDisplayName(state.user)} mentioned you in a comment.`,
                link: `post.html?id=${post.id}#comment-${result.data?.id || newComment.id}`,
                created_at: new Date().toISOString()
              });
            }
          }
        }

        commentReplyTo = null;
        
        if (status === "pending") {
          if (notice) {
            notice.textContent = "✓ Comment submitted for approval.";
            notice.style.display = "block";
            notice.style.color = "green";
          }
        } else {
          if (notice) {
            notice.textContent = "✓ Comment posted!";
            notice.style.display = "block";
            notice.style.color = "green";
          }
          if (result.data) {
            comments.push(result.data);
          }
          if (state.user) {
            state.commentAuthors[state.user.id] = {
              id: state.user.id,
              username: state.profile?.username || "",
              display_name: getDisplayName(state.user)
            };
          }
          renderComments(comments);
          await notifyMentionTargets(mentionedUsernames, post, result.data?.id || newComment.id);
        }

        if (state.user) {
          await incrementProfilePoints(state.user.id, 2);
        }
      } catch (err) {
        console.error("Comment commit error:", err);
        if (notice) {
          notice.textContent = `Error: ${err.message || "Failed to post comment"}`;
          notice.style.display = "block";
          notice.style.color = "red";
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Post Comment";
        }
      }
    };

    if (file) {
      if (!state.settings?.features?.allowImageComments) {
        if (notice) {
          notice.textContent = "Image comments are disabled by the admin.";
          notice.style.display = "block";
          notice.style.color = "orange";
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Post Comment";
        }
        return;
      }
      const uploadedUrl = await uploadMedia(file, "comments");
      if (!uploadedUrl) {
        if (notice) {
          notice.textContent = "Image upload failed. Try again.";
          notice.style.display = "block";
          notice.style.color = "red";
        }
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = "Post Comment";
        }
        return;
      }
      await commitComment(uploadedUrl);
    } else {
      await commitComment();
    }
  });
}

function renderAds(settings) {
  const postAd = document.getElementById("postInlineAd");
  if (!postAd) return;
  const activeAds = state.ads.filter(
    (ad) => ad.placement === "post_inline" || ad.placement === "global"
  );

  const now = new Date();
  const custom = activeAds.filter((ad) => {
    if (ad.status && ad.status !== "active") return false;
    if (ad.starts_at && new Date(ad.starts_at) > now) return false;
    if (ad.ends_at && new Date(ad.ends_at) < now) return false;
    return true;
  });

  if (custom.length) {
    const ad = custom[0];
    postAd.innerHTML = `
      <div class="ad-card">
        <div class="ad-label">Sponsored</div>
        ${ad.image_url ? `<img src="${ad.image_url}" alt="${escapeHTML(ad.title || "Ad image")}">` : ""}
        <strong>${escapeHTML(ad.title || "")}</strong>
        <p>${escapeHTML(ad.body || "")}</p>
        <a class="btn ghost" href="${ad.link_url}" target="_blank" rel="noopener">Visit</a>
      </div>
    `;
    return;
  }
  if (!settings.adSense.enabled || !settings.adSense.publisherId) return;
  if (!settings.adSense.slots.postInline) {
    postAd.innerHTML = "<div class=\"ad-slot\">Post ad slot not configured</div>";
    return;
  }
  postAd.innerHTML = `
    <ins class="adsbygoogle"
      style="display:block"
      data-ad-client="${settings.adSense.publisherId}"
      data-ad-slot="${settings.adSense.slots.postInline}"
      data-ad-format="auto"
      data-full-width-responsive="true"></ins>
  `;
  if (!document.getElementById("adsbygoogle-script")) {
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
  try {
    console.log("🚀 post.js boot() starting...");
    
    state.user = await getCurrentUserWithRole();
    state.settings = await fetchSettings();
    applyTheme(state.settings);
    if (state.settings.themeId) {
      const theme = await fetchThemeById(state.settings.themeId);
      if (theme) applyThemeVariables(theme);
    }
    renderAuthActions();
    showAdminLinks();

    const postId = getQueryParam("id");
    const slug = getQueryParam("slug");
    console.log("📍 Query params - ID:", postId, "Slug:", slug);
    
    const post = await fetchPostByIdOrSlug({ id: postId, slug });
    console.log("📄 Post loaded:", post);

    if (!post) {
      console.warn("⚠️ Post not found for id:", postId, "slug:", slug);
      document.getElementById("postTitle").textContent = "Post not found";
      document.getElementById("postContent").innerHTML =
        "<p>This post does not exist. Return to the homepage.</p>";
      return;
    }
    
    console.log("✅ Post found:", post.title);

    updateMeta(post);

    const [categories, relatedPosts, comments, likes, ads, postMedia] = await Promise.all([
      fetchCategories(),
      fetchPosts({ status: "published" }),
      fetchComments({ status: "approved", postId: post.id }),
      fetchPostLikes({ postId: post.id }),
      fetchAds({ status: "active" }),
      fetchPostMedia(post.id)
    ]);

    state.categories = categories;
    state.likes = likes;
    state.ads = ads;
    state.postMedia = postMedia;
    state.likeCount = likes.length;
    state.hasLiked = !!state.user && likes.some((like) => like.user_id === state.user.id);
    state.authorPostCount = relatedPosts.filter((item) => item.author_id === post.author_id).length;
    if (post.author_id) {
      const profile = await supabase
        .from("profiles")
        .select("*")
        .eq("id", post.author_id)
        .maybeSingle();
      state.authorProfile = profile.data || null;
    }
    if (state.user) {
      state.isBookmarked = await fetchBookmarkStatus(post.id, state.user.id);
    }
    if (state.user && post.author_id) {
      state.isFollowingAuthor = await fetchFollowStatus({
        targetType: "author",
        targetId: post.author_id,
        followerId: state.user.id
      });
    }

    renderPost({ categories }, post);
    renderGallery(state.postMedia);
    await loadCommentAuthors(comments);
    renderComments(comments);
    renderRelated({ posts: relatedPosts }, post);
    renderTakeaways(post);
    renderAuthorMini(post);
    renderAuthorCard(post);
    await incrementViewIfNeeded(post);
    renderAds(state.settings);
    setupLike(post);
    setupBookmark(post);
    setupFollowAuthor(post);
    setupShare(post);
    setupCommentForm(post, comments);
    setupReveal();
  } catch (err) {
    console.error("post boot failed:", err);
    document.getElementById("postTitle").textContent = "Error loading post";
    document.getElementById("postContent").innerHTML =
      "<p>Something went wrong while loading this post. Try refreshing or contact support.</p>";
  }
}

boot();
