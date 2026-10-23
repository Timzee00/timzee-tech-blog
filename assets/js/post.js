import {
  fetchCategories,
  fetchPosts,
  fetchFeedPosts,
  fetchPostCommentPage,
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
  incrementPostViews,
  createContentReport,
} from "./data.js";
import {fetchPostEngagement} from "./post-engagement.mjs";
import {verifiedName,verifiedAvatar,verifiedCommentClass} from "./verified-identity.mjs";
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
  linkifyReferences,
  isSafeUrl,
  normalizeHtml,
  extractErrorMessage,
  reportAppError
} from "./utils.js";
import { setupReveal } from "./reveal.js";
import {mountArticleJourney} from "./reader-journey.mjs";
import "./nav.js";
import {stripEditorialScaffolding} from "./public-editorial-content.mjs";

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
  commentIndex: {},
  comments: [],
  commentCursor: null,
  commentsHasMore: false
};

let commentReplyTo = null;
let commentChannel = null;

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
  const excerpt = clampText(stripHTML(stripEditorialScaffolding(post.content || "")), 160);
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
    profile.href = `profile.html?id=${encodeURIComponent(state.user.id)}`;
    profile.textContent = "Profile";
    // Notification bell/badge is owned exclusively by nav.js's
    // setupNotificationBadge(), which self-heals after this function
    // rebuilds #authActions — do not recreate it here.
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
    <button type="button" class="btn ghost small" id="reportPostBtn">Report</button>
  `;

  const reportBtn = document.getElementById("reportPostBtn");
  if (reportBtn) {
    reportBtn.addEventListener("click", async () => {
      if (!state.user) {
        window.appUI.toast("Please log in to report.");
        return;
      }
      const reason = await window.appUI.prompt("Why are you reporting this post?");
      if (reason === null) return;
      const result = await createContentReport({
        reporterId: state.user.id,
        contentType: "post",
        contentId: post.id,
        reason: reason.trim()
      });
      if (result?.error) {
        window.appUI.toast(result.error.message || "Failed to submit report.");
      } else {
        window.appUI.toast("Report submitted. Thank you.");
      }
    });
  }

  const cover = document.getElementById("postCover");
  if (cover) {
    cover.innerHTML =
      post.cover && isSafeUrl(post.cover)
        ? `<img src="${escapeHTML(post.cover)}" alt="${escapeHTML(post.title || "Post cover")}">`
        : "";
  }
  for (const [id,action] of [["summarizePostAi","summarize"],["chatPostAi","chat"]]) {
    document.getElementById(id)?.addEventListener("click",()=>{
      // Same-origin session storage: do not put article text in the URL,
      // referrer or telemetry. The AI still requires signed-in consent.
      const article=stripHTML(stripEditorialScaffolding(post.content||"")).slice(0,7500);
      const context={title:String(post.title||"Article").slice(0,220),
        url:location.href,excerpt:article,action,created:Date.now()};
      sessionStorage.setItem("timzee:article-ai-context",JSON.stringify(context));
      window.location.assign("ai-chat.html?articleContext=1");
    });
  }
  const postBody = document.getElementById("postContent");
  if (postBody) {
    postBody.innerHTML = normalizeHtml(stripEditorialScaffolding(post.content || ""));
  }

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
  // An editorial Key Takeaways box is not the first three article sentences.
  // Old articles without authored takeaways simply omit the box.
  const tag=String(post.content||"").match(/data-timzee-takeaways="([^"]+)"/);
  if(!tag)return [];
  try {
    const parsed=JSON.parse(decodeURIComponent(tag[1].replace(/&amp;/g,"&")));
    return Array.isArray(parsed) ? parsed
      .filter(x=>typeof x==="string"&&x.trim().length>=25).slice(0,4) : [];
  } catch { return []; }
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
  // Identity is derived from the protected public profile, not post metadata.
  const badgeSet = buildAuthorBadges(profile);
  const avatar=verifiedAvatar(profile?.avatar_url,profile,{size:"md",alt:"Author portrait"});
  const link = profile?.id ? `profile.html?id=${encodeURIComponent(profile.id)}` : "profile.html";
  const canFollow = state.user && profile?.id && profile.id !== state.user.id;
  const followBtn = canFollow
    ? `<button class="btn ghost" id="followAuthorBtn">${state.isFollowingAuthor ? "Following" : "Follow"}</button>`
    : `<a class="btn ghost" href="${link}">View profile</a>`;
  wrap.innerHTML = `
    <a href="${link}" class="tz-avatar-link" aria-label="View profile">${avatar}</a>
    <div>
      <div class="author-name">${verifiedName(name,profile,{compact:true})}</div>
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
  // Shared identity renderer prevents cross-page badge mismatches.
  const badgeSet = buildAuthorBadges(profile);
  const bio =
    profile?.bio ||
    "Writes about tech, product design, and what to watch in the community this week.";
  const avatar=verifiedAvatar(profile?.avatar_url,profile,{size:"lg",alt:"Author portrait"});
  const link = profile?.id ? `profile.html?id=${encodeURIComponent(profile.id)}` : "profile.html";
  const postsLabel = state.authorPostCount ? `${state.authorPostCount} posts` : "Featured author";
  card.innerHTML = `
    <div class="author-card">
      <a href="${link}" class="tz-avatar-link" aria-label="View profile">${avatar}</a>
      <div>
        <div class="author-name">${verifiedName(name,profile,{compact:true})}</div>
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
  const safeItems = (Array.isArray(mediaItems) ? mediaItems : [])
    .filter((item) => item && typeof item.url === "string" && isSafeUrl(item.url));
  if (!safeItems.length) {
    gallery.innerHTML = "";
    return;
  }
  gallery.innerHTML = safeItems.slice(0, 12)
    .map((item, index) => {
      const url = escapeHTML(item.url);
      if (item.media_type === "video") {
        return `<figure class="post-gallery-item"><video controls playsinline preload="metadata" src="${url}"></video><figcaption>Video ${index + 1}</figcaption></figure>`;
      }
      return `<figure class="post-gallery-item"><a href="${url}" target="_blank" rel="noopener noreferrer" aria-label="Open article image ${index + 1} in new tab"><img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="${url}" alt="Article image ${index + 1}"></a><figcaption>Image ${index + 1} · opens original file</figcaption></figure>`;
    })
    .join("");
  gallery.querySelectorAll("img").forEach(image => image.addEventListener("error", () => {
    image.closest(".post-gallery-item")?.remove();
    if (!gallery.children.length) gallery.textContent = "Article images could not be loaded from their source.";
  }, { once: true }));
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
      const reportButton = `<button type="button" class="btn ghost small report-comment-btn" data-id="${comment.id}">Report</button>`;
      return `
        <div class="comment-card ${verifiedCommentClass(authorProfile)}" data-reveal id="comment-${comment.id}">
          <div class="comment-meta"><span class="tz-comment-author">${comment.author_id ? verifiedAvatar(authorProfile?.avatar_url,authorProfile,{size:"sm",alt:""}) : ""}${
            comment.author_id
              ? `<a href="profile.html?id=${encodeURIComponent(comment.author_id)}">${verifiedName(
                  comment.author_name || "Member",authorProfile,{compact:true}
                )}</a>`
              : verifiedName(comment.author_name || "Member",null,{compact:true})
          }</span><span>${timeAgo(comment.created_at)}</span></div>
          ${replySnippet}
          <div>${safeBody}</div>
          ${
            comment.image && isSafeUrl(comment.image)
              ? `<img src="${escapeHTML(comment.image)}" alt="comment image" loading="lazy" style="border-radius:12px; max-height:200px;">`
              : ""
        }
        <div class="comment-actions">${replyButton || ""}${reportButton}</div>
      </div>
    `;
  })
  .join("");
  setupReveal(list);
  bindCommentReplyButtons();
  bindCommentReportButtons();
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

function bindCommentReportButtons() {
  const list = document.getElementById("commentList");
  if (!list) return;
  list.querySelectorAll(".report-comment-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!state.user) {
        window.appUI.toast("Please log in to report.");
        return;
      }
      const reason = await window.appUI.prompt("Why are you reporting this comment?");
      if (reason === null) return;
      const result = await createContentReport({
        reporterId: state.user.id,
        contentType: "comment",
        contentId: btn.dataset.id,
        reason: reason.trim()
      });
      if (result?.error) {
        window.appUI.toast(result.error.message || "Failed to submit report.");
      } else {
        window.appUI.toast("Report submitted. Thank you.");
      }
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

async function notifyMentionTargets() {
  // Mentions are persisted on the comment and the database notification trigger
  // creates the recipient notification while honoring private preferences.
  return;
}

async function loadCommentAuthors(comments) {
  const ids = Array.from(
    new Set(comments.map((comment) => comment.author_id).filter(Boolean))
  );
  if (!ids.length) return;
  const missing=ids.filter(id=>!state.commentAuthors[id]);
  if(!missing.length)return;
  const profiles = await fetchProfilesByIds(missing);
  const map = {...state.commentAuthors};
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
      window.appUI.toast("Please log in to like posts.");
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
      window.appUI.toast("Please log in to share posts.");
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
        window.appUI.toast("Sharing is not supported here. Use copy link instead.");
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
        window.appUI.toast("Copy failed. Please copy the URL manually.");
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
      window.appUI.toast("Please log in to save posts.");
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
      window.appUI.toast("Please log in to follow authors.");
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

        // Comment replies, post-owner notifications, and mentions are emitted
        // by the database trigger after the comment is persisted.
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
            state.comments = comments;
          }
          if (state.user) {
            // Preserve trusted server-issued verification, not client user
            // metadata. Otherwise the badge disappears just after commenting.
            const ownProfile=(await fetchProfilesByIds([state.user.id]))[0]||
              state.commentAuthors[state.user.id]||{};
            state.commentAuthors[state.user.id]={
              ...ownProfile,id:state.user.id,
              display_name:ownProfile.display_name||getDisplayName(state.user)
            };
          }
          renderComments(comments);
          await notifyMentionTargets();
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

function handleIncomingComment(payload, postId) {
  const comment = payload?.new;
  if (!comment || comment.post_id !== postId) return;
  if (comment.status && comment.status !== "approved") return;
  const idx = state.comments.findIndex((item) => item.id === comment.id);
  if (idx >= 0) {
    state.comments[idx] = comment;
  } else {
    state.comments.push(comment);
  }
  state.comments.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  renderComments(state.comments);
  void loadCommentAuthors([comment]).then(()=>renderComments(state.comments))
    .catch(error=>console.warn("Comment author unavailable:",error));
}

function subscribeToComments(postId) {
  if (!postId || typeof supabase?.channel !== "function") return;
  if (commentChannel) {
    supabase.removeChannel(commentChannel);
    commentChannel = null;
  }
  commentChannel = supabase
    .channel(`comments-live-${postId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "comments", filter: `post_id=eq.${postId}` },
      (payload) => handleIncomingComment(payload, postId)
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "comments", filter: `post_id=eq.${postId}` },
      (payload) => handleIncomingComment(payload, postId)
    )
    .subscribe();
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
        ${ad.image_url && isSafeUrl(ad.image_url) ? `<img src="${escapeHTML(ad.image_url)}" alt="${escapeHTML(ad.title || "Ad image")}">` : ""}
        <strong>${escapeHTML(ad.title || "")}</strong>
        <p>${escapeHTML(ad.body || "")}</p>
        <a class="btn ghost" href="${isSafeUrl(ad.link_url) ? escapeHTML(ad.link_url) : '#'}" target="_blank" rel="noopener">Visit</a>
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

function setupCommentPagination(postId){
  const button=document.getElementById("loadMoreArticleComments");
  const status=document.getElementById("loadMoreArticleCommentsStatus");
  if(!button)return;
  button.hidden=!state.commentsHasMore;
  let loading=false;
  button.addEventListener("click",async()=>{
    if(loading||!state.commentsHasMore||!state.commentCursor)return;
    loading=true;button.disabled=true;
    if(status)status.textContent="Loading more comments…";
    try{
      const page=await fetchPostCommentPage({postId,cursor:state.commentCursor,limit:40});
      state.commentCursor=page.nextCursor;
      state.commentsHasMore=page.hasMore;
      const seen=new Set(state.comments.map(comment=>comment.id));
      const next=page.items.filter(comment=>!seen.has(comment.id));
      state.comments.push(...next);
      await loadCommentAuthors(next);
      renderComments(state.comments);
      button.hidden=!state.commentsHasMore;
      if(status)status.textContent=next.length+" more comments loaded.";
    }catch(error){
      if(status)status.textContent="Couldn't load older comments. Please retry.";
      console.warn("Comment page unavailable:",error);
    }finally{
      loading=false;button.disabled=false;
    }
  });
}

async function boot() {
  try {
    // Public article content must never wait for auth, theme or sidebar.
    const optional=(promise,fallback,label)=>Promise.resolve(promise).catch(error=>{
      console.warn("Optional article data unavailable:",label,error);
      return fallback;
    });
    const userPromise=optional(getCurrentUserWithRole(),null,"identity");
    const settingsPromise=optional(fetchSettings(),{},"settings");
    const postId=getQueryParam("id"),slug=getQueryParam("slug");
    const post=await fetchPostByIdOrSlug({id:postId,slug});
    if(!post){
      document.getElementById("postTitle").textContent="Post not found";
      document.getElementById("postContent").innerHTML=
        '<p>This post is unavailable or may have been removed.</p><a class="btn" href="/index.html">Explore the latest posts</a>';
      document.querySelectorAll("#commentForm, #comments, .post-actions, .post-review")
        .forEach(node=>{node.hidden=true;});
      return;
    }
    updateMeta(post);
    const liveLink=document.getElementById("discussArticleLive");
    if(liveLink&&post.id)liveLink.href="spaces.html?post="+encodeURIComponent(post.id);
    // Render the article immediately with a temporary category label, then
    // update that label without rebuilding the full HTML and its listeners.
    renderPost({categories:[]},post);
    renderTakeaways(post);
    setupReveal();

    const profilePromise=post.author_id
      ?supabase.from("public_profiles")
        .select("id,display_name,username,avatar_url,headline,bio,is_verified,verification_tier,verification_expires_at,frame_style")
        .eq("id",post.author_id).maybeSingle()
      :Promise.resolve({data:null,error:null});
    const authorCountPromise=post.author_id
      ?supabase.from("posts").select("id",{count:"exact",head:true})
        .eq("status","published").eq("author_id",post.author_id)
      :Promise.resolve({count:0,error:null});

    const [user,settings,categories,relatedPage,commentPage,engagement,ads,postMedia,profileResult,authorCount] = await Promise.all([
      userPromise,
      settingsPromise,
      optional(fetchCategories(),[],"categories"),
      optional(fetchFeedPosts({limit:24,categoryId:post.category_id||null}),{items:[]},"related posts"),
      optional(fetchPostCommentPage({postId:post.id,limit:40}),{
        items:[],hasMore:false,nextCursor:null
      },"comments"),
      fetchPostEngagement(supabase,[post.id])
        .catch(error=>{console.warn("Article engagement unavailable:",error);return null;}),
      optional(fetchAds({status:"active",limit:8}),[],"advertising"),
      optional(fetchPostMedia(post.id),[],"article media"),
      optional(profilePromise,{data:null},"author profile"),
      optional(authorCountPromise,{count:0},"author count")
    ]);
    state.user=user;
    state.settings=settings;
    applyTheme(state.settings);
    if(state.settings.themeId){
      void fetchThemeById(state.settings.themeId)
        .then(theme=>{if(theme)applyThemeVariables(theme);})
        .catch(error=>console.warn("Article theme unavailable:",error));
    }
    renderAuthActions();
    showAdminLinks();
    state.categories=categories;
    const category=categories.find(cat=>cat.id===post.category_id);
    const categoryLabel=document.getElementById("postCategory");
    if(categoryLabel&&category)categoryLabel.textContent=category.name;
    state.ads=ads;
    state.postMedia=postMedia;
    state.likeCount=Math.max(0,Number(engagement?.likeCounts?.[post.id])||0);
    state.hasLiked=Boolean(user&&engagement?.likedPostIds?.includes(post.id));
    state.authorPostCount=Math.max(0,Number(authorCount?.count)||0);
    state.authorProfile=profileResult?.data||null;
    state.comments=commentPage.items;
    state.commentCursor=commentPage.nextCursor;
    state.commentsHasMore=commentPage.hasMore;

    updateCounts(post);
    renderGallery(state.postMedia);
    await optional(loadCommentAuthors(state.comments),null,"comment authors");
    renderComments(state.comments);
    setupCommentPagination(post.id);
    renderRelated({posts:relatedPage.items},post);
    renderAuthorMini(post);
    renderAuthorCard(post);

    // Private extras may require auth; process concurrently without delaying
    // the already-rendered article or its public comments.
    if(user?.id){
      const [saved,following]=await Promise.all([
        optional(fetchBookmarkStatus(post.id,user.id),false,"bookmark status"),
        post.author_id?optional(fetchFollowStatus({
          targetType:"author",targetId:post.author_id,followerId:user.id
        }),false,"follow status"):Promise.resolve(false)
      ]);
      state.isBookmarked=saved;
      state.isFollowingAuthor=following;
      renderAuthorMini(post);
    }
    renderAds(state.settings);
    setupLike(post);
    setupBookmark(post);
    setupFollowAuthor(post);
    setupShare(post);
    setupCommentForm(post,state.comments);
    subscribeToComments(post.id);
    void incrementViewIfNeeded(post);
    // Optional private reader progress should never block the article.
    void mountArticleJourney({post,user:state.user});
  }catch(err){
    reportAppError(err,"Post load failed");
    const message=extractErrorMessage(err,"Something went wrong while loading this post.");
    const title=document.getElementById("postTitle");
    if(title&&!title.textContent)title.textContent="Error loading post";
    const body=document.getElementById("postContent");
    if(body&&!body.textContent.trim())body.innerHTML='<p>'+escapeHTML(message)+'</p>';
  }
}

boot();
