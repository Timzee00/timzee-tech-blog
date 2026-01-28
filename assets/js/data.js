import { supabase } from "./supabase.js";

function normalizeResponse(result) {
  if (result.error) {
    console.warn("Supabase query failed", result.error);
    return [];
  }
  return result.data || [];
}

export async function fetchCategories() {
  const result = await supabase.from("categories").select("*").order("name");
  return normalizeResponse(result);
}

export async function fetchPosts({ status, contentType } = {}) {
  let query = supabase.from("posts").select("*").order("created_at", { ascending: false });
  let normalized = "";
  if (status) {
    normalized = String(status).toLowerCase();
    if (normalized === "published") {
      // Treat NULL status as published for legacy/manual inserts.
      query = query.or("status.is.null,status.ilike.published,status.ilike.scheduled");
    } else {
      query = query.eq("status", status);
    }
  }
  if (contentType) {
    query = query.eq("content_type", contentType);
  }
  const result = await query;
  let rows = normalizeResponse(result);
  if (normalized === "published") {
    const now = Date.now();
    rows = rows.filter((post) => {
      if (!post.status || post.status === "published") return true;
      if (post.status === "scheduled") {
        if (!post.publish_at) return false;
        return new Date(post.publish_at).getTime() <= now;
      }
      return false;
    });
  }
  return rows;
}

export async function fetchPostMedia(postId) {
  if (!postId) return [];
  const result = await supabase
    .from("post_media")
    .select("*")
    .eq("post_id", postId)
    .order("sort_order", { ascending: true });
  return normalizeResponse(result);
}

export async function createPostMedia(payload) {
  return supabase.from("post_media").insert(payload).select().single();
}

export async function deletePostMedia(id) {
  return supabase.from("post_media").delete().eq("id", id);
}

export async function fetchPostByIdOrSlug({ id, slug }) {
  if (!id && !slug) return null;
  let query = supabase.from("posts").select("*").limit(1);
  if (id) query = query.eq("id", id);
  if (!id && slug) query = query.eq("slug", slug);
  const result = await query.maybeSingle();
  if (result.error) {
    console.warn("Post lookup failed", result.error);
    return null;
  }
  return result.data || null;
}

export async function fetchComments({ status, postId } = {}) {
  let query = supabase.from("comments").select("*").order("created_at", { ascending: true });
  if (status) query = query.eq("status", status);
  if (postId) query = query.eq("post_id", postId);
  const result = await query;
  return normalizeResponse(result);
}

export async function fetchDiscussionTopics() {
  const result = await supabase
    .from("discussion_topics")
    .select("*")
    .order("updated_at", { ascending: false });
  return normalizeResponse(result);
}

export async function fetchDiscussionMessages() {
  const result = await supabase
    .from("discussion_messages")
    .select("id, topic_id")
    .order("created_at", { ascending: false });
  return normalizeResponse(result);
}

export async function fetchPostLikes({ postId } = {}) {
  let query = supabase.from("post_likes").select("id, post_id, user_id");
  if (postId) query = query.eq("post_id", postId);
  const result = await query;
  return normalizeResponse(result);
}

export async function fetchThemes() {
  const result = await supabase.from("themes").select("*").order("name");
  return normalizeResponse(result);
}

export async function fetchAds({ status, placement } = {}) {
  let query = supabase.from("ads").select("*").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (placement) query = query.eq("placement", placement);
  const result = await query;
  return normalizeResponse(result);
}

export async function fetchContactRequests() {
  const result = await supabase
    .from("contact_requests")
    .select("*")
    .order("created_at", { ascending: false });
  return normalizeResponse(result);
}

export async function fetchSupportRequests() {
  const result = await supabase
    .from("support_requests")
    .select("*")
    .order("created_at", { ascending: false });
  return normalizeResponse(result);
}

export async function fetchNewsletterSignups() {
  const result = await supabase
    .from("newsletter_signups")
    .select("*")
    .order("created_at", { ascending: false });
  return normalizeResponse(result);
}

export async function fetchAdApplications() {
  const result = await supabase
    .from("ad_applications")
    .select("*")
    .order("created_at", { ascending: false });
  return normalizeResponse(result);
}

export async function updateContactRequestStatus(id, status) {
  return supabase.from("contact_requests").update({ status }).eq("id", id).select().single();
}

export async function updateSupportRequestStatus(id, status) {
  return supabase.from("support_requests").update({ status }).eq("id", id).select().single();
}

export async function updateNewsletterSignupStatus(id, status) {
  return supabase.from("newsletter_signups").update({ status }).eq("id", id).select().single();
}

export async function updateAdApplicationStatus(id, status) {
  return supabase.from("ad_applications").update({ status }).eq("id", id).select().single();
}

export async function createTheme(payload) {
  return supabase.from("themes").insert(payload).select().single();
}

export async function createAd(payload) {
  return supabase.from("ads").insert(payload).select().single();
}

export async function createCategory({ name, description, color }) {
  return supabase
    .from("categories")
    .insert({ id: crypto.randomUUID(), name, description, color })
    .select()
    .single();
}

export async function createPost(payload) {
  return supabase.from("posts").insert(payload).select().single();
}

export async function updatePost(id, updates) {
  return supabase.from("posts").update(updates).eq("id", id).select().single();
}

export async function updateAd(id, updates) {
  return supabase.from("ads").update(updates).eq("id", id).select().single();
}

export async function deletePost(id) {
  return supabase.from("posts").delete().eq("id", id);
}

export async function deleteAd(id) {
  return supabase.from("ads").delete().eq("id", id);
}

export async function createComment(payload) {
  return supabase.from("comments").insert(payload).select().single();
}

export async function updateCommentStatus(id, status) {
  return supabase.from("comments").update({ status }).eq("id", id).select().single();
}

export async function deleteComment(id) {
  return supabase.from("comments").delete().eq("id", id);
}

export async function togglePostLike(postId, userId) {
  const existing = await supabase
    .from("post_likes")
    .select("id")
    .eq("post_id", postId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing.error) {
    console.warn("Like lookup failed", existing.error);
    return { liked: false };
  }

  if (existing.data) {
    const removed = await supabase.from("post_likes").delete().eq("id", existing.data.id);
    if (removed.error) {
      console.warn("Like removal failed", removed.error);
      return { liked: true };
    }
    return { liked: false };
  }

  const inserted = await supabase.from("post_likes").insert({
    id: crypto.randomUUID(),
    post_id: postId,
    user_id: userId
  });
  if (inserted.error) {
    console.warn("Like insert failed", inserted.error);
    return { liked: false };
  }
  return { liked: true };
}

export async function createPostShare(payload) {
  return supabase.from("post_shares").insert(payload);
}

export async function incrementPostViews(postId, currentViews = 0) {
  const next = currentViews + 1;
  const result = await supabase
    .from("posts")
    .update({ views: next })
    .eq("id", postId)
    .select("views")
    .single();
  if (result.error) {
    console.warn("View increment failed", result.error);
    return currentViews;
  }
  return result.data.views ?? next;
}

export async function searchPosts({ query = "", tags = [] } = {}) {
  let searchQuery = query.trim();
  let filterTags = Array.isArray(tags) ? tags.filter(Boolean) : [];
  let request = supabase
    .from("posts")
    .select("*")
    .or("status.is.null,status.eq.published,status.eq.scheduled")
    .order("created_at", { ascending: false });

  if (searchQuery) {
    request = request.textSearch("search_vector", searchQuery, {
      type: "websearch",
      config: "english"
    });
  }
  if (filterTags.length) {
    request = request.overlaps("tags", filterTags);
  }

  const result = await request;
  let rows = normalizeResponse(result);
  const now = Date.now();
  rows = rows.filter((post) => {
    if (!post.status || post.status === "published") return true;
    if (post.status === "scheduled") {
      if (!post.publish_at) return false;
      return new Date(post.publish_at).getTime() <= now;
    }
    return false;
  });
  return rows;
}

export async function fetchTopProfiles(limit = 5) {
  const result = await supabase
    .from("profiles")
    .select("id, display_name, username, avatar_url, points, level, is_verified, is_featured, is_staff_pick")
    .order("points", { ascending: false })
    .limit(limit);
  return normalizeResponse(result);
}

export async function createContentRequest(payload) {
  return supabase.from("content_requests").insert(payload).select().single();
}

export async function fetchContentRequests() {
  const result = await supabase
    .from("content_requests")
    .select("*")
    .order("created_at", { ascending: false });
  return normalizeResponse(result);
}

export async function updateContentRequestStatus(id, status) {
  return supabase.from("content_requests").update({ status }).eq("id", id).select().single();
}

export async function createAdminRequest(payload) {
  return supabase.from("admin_requests").insert(payload).select().single();
}

export async function fetchAdminRequests() {
  const result = await supabase
    .from("admin_requests")
    .select("*")
    .order("created_at", { ascending: false });
  return normalizeResponse(result);
}

export async function updateAdminRequestStatus(id, status, reviewedBy = null) {
  const updates = { status, reviewed_at: new Date().toISOString() };
  if (reviewedBy) updates.reviewed_by = reviewedBy;
  return supabase.from("admin_requests").update(updates).eq("id", id).select().single();
}

export async function toggleBookmark(postId, userId) {
  if (!postId || !userId) return { saved: false };
  const existing = await supabase
    .from("bookmarks")
    .select("id")
    .eq("post_id", postId)
    .eq("user_id", userId)
    .maybeSingle();

  if (existing.error) {
    console.warn("Bookmark lookup failed", existing.error);
    return { saved: false };
  }

  if (existing.data) {
    const removed = await supabase.from("bookmarks").delete().eq("id", existing.data.id);
    if (removed.error) {
      console.warn("Bookmark removal failed", removed.error);
      return { saved: true };
    }
    return { saved: false };
  }

  const inserted = await supabase.from("bookmarks").insert({
    id: crypto.randomUUID(),
    post_id: postId,
    user_id: userId,
    created_at: new Date().toISOString()
  });
  if (inserted.error) {
    console.warn("Bookmark insert failed", inserted.error);
    return { saved: false };
  }
  return { saved: true };
}

export async function fetchBookmarkStatus(postId, userId) {
  if (!postId || !userId) return false;
  const result = await supabase
    .from("bookmarks")
    .select("id")
    .eq("post_id", postId)
    .eq("user_id", userId)
    .maybeSingle();
  return !!result.data;
}

export async function fetchBookmarks(userId) {
  if (!userId) return [];
  const result = await supabase
    .from("bookmarks")
    .select("id, post_id, created_at, posts(id, title, cover, created_at)")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  return normalizeResponse(result);
}

export async function toggleFollow({ targetType, targetId, followerId }) {
  if (!targetType || !targetId || !followerId) return { following: false };
  const existing = await supabase
    .from("follows")
    .select("id")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("follower_id", followerId)
    .maybeSingle();

  if (existing.error) {
    console.warn("Follow lookup failed", existing.error);
    return { following: false };
  }

  if (existing.data) {
    const removed = await supabase.from("follows").delete().eq("id", existing.data.id);
    if (removed.error) {
      console.warn("Unfollow failed", removed.error);
      return { following: true };
    }
    return { following: false };
  }

  const inserted = await supabase.from("follows").insert({
    id: crypto.randomUUID(),
    target_type: targetType,
    target_id: targetId,
    follower_id: followerId,
    created_at: new Date().toISOString()
  });
  if (inserted.error) {
    console.warn("Follow insert failed", inserted.error);
    return { following: false };
  }
  return { following: true };
}

export async function fetchFollowStatus({ targetType, targetId, followerId }) {
  if (!targetType || !targetId || !followerId) return false;
  const result = await supabase
    .from("follows")
    .select("id")
    .eq("target_type", targetType)
    .eq("target_id", targetId)
    .eq("follower_id", followerId)
    .maybeSingle();
  return !!result.data;
}

export async function fetchNotifications(userId) {
  if (!userId) return [];
  const result = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(50);
  return normalizeResponse(result);
}

export async function markNotificationRead(id) {
  return supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
}

export async function markAllNotificationsRead(userId) {
  return supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId);
}

export async function fetchUnreadNotificationCount(userId) {
  if (!userId) return 0;
  const result = await supabase
    .from("notifications")
    .select("id")
    .eq("user_id", userId)
    .is("read_at", null);
  if (result.error) {
    console.warn("Notification count failed", result.error);
    return 0;
  }
  return (result.data || []).length;
}

export async function fetchProfilesByUsernames(usernames = []) {
  const list = Array.isArray(usernames) ? usernames.filter(Boolean) : [];
  if (!list.length) return [];
  const result = await supabase
    .from("profiles")
    .select("id, username, display_name, notify_mentions, notify_messages")
    .in("username", list);
  return normalizeResponse(result);
}

export async function fetchCuratorSettings() {
  const result = await supabase.from("curator_settings").select("*").maybeSingle();
  return result.data || null;
}

export async function upsertCuratorSettings(payload) {
  return supabase.from("curator_settings").upsert(payload).select().single();
}

export async function fetchCuratorSources() {
  const result = await supabase
    .from("curator_sources")
    .select("*")
    .order("created_at", { ascending: false });
  return normalizeResponse(result);
}

export async function createCuratorSource(payload) {
  return supabase.from("curator_sources").insert(payload).select().single();
}

export async function updateCuratorSource(id, updates) {
  return supabase.from("curator_sources").update(updates).eq("id", id).select().single();
}

export async function deleteCuratorSource(id) {
  return supabase.from("curator_sources").delete().eq("id", id);
}

export async function fetchCuratorDrafts(status = "draft") {
  const result = await supabase
    .from("curator_posts")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false });
  return normalizeResponse(result);
}

export async function updateCuratorDraftStatus(id, status) {
  return supabase
    .from("curator_posts")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .single();
}

export async function fetchMarketplaceListings({ status = "active" } = {}) {
  let query = supabase.from("marketplace_listings").select("*").order("created_at", {
    ascending: false
  });
  if (status) query = query.eq("status", status);
  const result = await query;
  return normalizeResponse(result);
}

export async function createMarketplaceListing(payload) {
  return supabase.from("marketplace_listings").insert(payload).select().single();
}

export async function updateMarketplaceListing(id, updates) {
  return supabase
    .from("marketplace_listings")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
}

export async function fetchShortVideos({ status = "published" } = {}) {
  let query = supabase.from("short_videos").select("*").order("created_at", {
    ascending: false
  });
  if (status) query = query.eq("status", status);
  const result = await query;
  return normalizeResponse(result);
}

export async function createShortVideo(payload) {
  return supabase.from("short_videos").insert(payload).select().single();
}

export async function fetchProfilesByIds(ids = []) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length) return [];
  const result = await supabase
    .from("profiles")
    .select("id, username, display_name, avatar_url, notify_mentions")
    .in("id", list);
  return normalizeResponse(result);
}

export async function incrementProfilePoints(userId, delta = 1) {
  if (!userId || !delta) return null;
  const result = await supabase.rpc("increment_profile_points", {
    p_user_id: userId,
    p_delta: delta
  });
  if (result.error) {
    console.warn("Point increment failed", result.error);
    return null;
  }
  return result.data;
}

// ============================================================================
// NOTIFICATION FUNCTIONS
// ============================================================================

export async function createNotification({
  userId,
  type,
  title,
  body,
  linkUrl = null,
  data = {}
} = {}) {
  return supabase.from("notifications").insert({
    id: crypto.randomUUID(),
    user_id: userId,
    type,
    title,
    body,
    link_url: linkUrl,
    data,
    created_at: new Date().toISOString()
  }).select().single();
}

export async function getUserNotifications(userId, limit = 50, offset = 0) {
  const result = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);
  
  return normalizeResponse(result);
}

export async function getUnreadNotificationCount(userId) {
  const result = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("read_at", null);
  
  return result.count || 0;
}

export async function markNotificationRead(notificationId) {
  return supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .select()
    .single();
}

export async function markAllNotificationsRead(userId) {
  return supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("user_id", userId)
    .is("read_at", null);
}

export async function deleteNotification(notificationId) {
  return supabase.from("notifications").delete().eq("id", notificationId);
}

// Notification helpers for common events
export async function notifyFriendRequest(recipientId, senderName, senderId) {
  return createNotification({
    userId: recipientId,
    type: "friend_request",
    title: "New Friend Request",
    body: `${senderName} sent you a friend request`,
    linkUrl: `/profile.html?id=${senderId}`,
    data: { sender_id: senderId }
  });
}

export async function notifyFriendRequestAccepted(userId, accepterName) {
  return createNotification({
    userId,
    type: "friend_request_accepted",
    title: "Friend Request Accepted",
    body: `${accepterName} accepted your friend request`,
    linkUrl: `/chat.html`
  });
}

export async function notifyMention(userId, mentionerName, postId, commentId) {
  return createNotification({
    userId,
    type: "mention",
    title: "You were mentioned",
    body: `${mentionerName} mentioned you in a comment`,
    linkUrl: `/post.html?id=${postId}#comment-${commentId}`,
    data: { post_id: postId, comment_id: commentId }
  });
}

export async function notifyCommentReply(userId, replierName, postId, commentId) {
  return createNotification({
    userId,
    type: "comment_reply",
    title: "New reply to your comment",
    body: `${replierName} replied to your comment`,
    linkUrl: `/post.html?id=${postId}#comment-${commentId}`,
    data: { post_id: postId, comment_id: commentId }
  });
}

export async function notifyAdminPromotion(userId, newRole) {
  return createNotification({
    userId,
    type: "admin_promotion",
    title: "You've been promoted",
    body: `You are now a ${newRole}`,
    linkUrl: `/admin/login.html`
  });
}

export async function notifyVerificationStatusChange(userId, status, message) {
  return createNotification({
    userId,
    type: "verification_status",
    title: `Verification ${status}`,
    body: message,
    linkUrl: `/profile.html`
  });
}

export async function notifyNewMessage(userId, senderName, senderId) {
  return createNotification({
    userId,
    type: "direct_message",
    title: "New message",
    body: `${senderName} sent you a message`,
    linkUrl: `/chat.html`,
    data: { sender_id: senderId }
  });
}

// ============================================================================
// VERIFICATION FUNCTIONS
// ============================================================================

export async function createVerificationApplication({
  userId,
  userEmail,
  userName,
  verificationType,
  documents = {},
  message = ""
} = {}) {
  return supabase.from("verification_applications").insert({
    id: crypto.randomUUID(),
    user_id: userId,
    user_email: userEmail,
    user_name: userName,
    verification_type: verificationType,
    documents,
    message,
    status: "pending",
    created_at: new Date().toISOString()
  }).select().single();
}

export async function getVerificationApplications(status = "pending") {
  const result = await supabase
    .from("verification_applications")
    .select("*")
    .eq("status", status)
    .order("created_at", { ascending: false });
  
  return normalizeResponse(result);
}

export async function updateVerificationApplication(applicationId, updates) {
  return supabase
    .from("verification_applications")
    .update(updates)
    .eq("id", applicationId)
    .select()
    .single();
}

export async function createVerificationBadge({
  userId,
  verificationLevel,
  verifiedBy,
  reason = ""
} = {}) {
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);

  return supabase.from("verification_badges").insert({
    id: crypto.randomUUID(),
    user_id: userId,
    verification_level: verificationLevel,
    verified_by: verifiedBy,
    verified_at: new Date().toISOString(),
    expires_at: expiresAt.toISOString(),
    reason,
    created_at: new Date().toISOString()
  }).select().single();
}

export async function getUserVerificationBadge(userId) {
  const result = await supabase
    .from("verification_badges")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (result.error) return null;
  
  const badge = result.data;
  if (badge.expires_at && new Date(badge.expires_at) < new Date()) {
    return null;
  }
  
  return badge;
}

export async function updateProfileVerification({
  userId,
  verificationLevel,
  verificationColor = null,
  profileDesign = "standard"
} = {}) {
  return supabase
    .from("profiles")
    .update({
      verification_level: verificationLevel,
      verification_color: verificationColor,
      profile_design: profileDesign,
      updated_at: new Date().toISOString()
    })
    .eq("id", userId)
    .select()
    .single();
}

export async function updateProfilePrivacy(userId, isPrivate) {
  return supabase
    .from("profiles")
    .update({
      is_private: isPrivate,
      updated_at: new Date().toISOString()
    })
    .eq("id", userId)
    .select()
    .single();
}

// ============================================================================
// PAGINATION HELPERS
// ============================================================================

export async function fetchPostsWithPagination({
  status = "published",
  categoryId = null,
  limit = 10,
  offset = 0
} = {}) {
  let query = supabase.from("posts").select("*");

  if (status === "published") {
    query = query.or("status.is.null,status.eq.published");
  } else {
    query = query.eq("status", status);
  }

  if (categoryId) {
    query = query.eq("category_id", categoryId);
  }

  query = query.order("created_at", { ascending: false });
  query = query.range(offset, offset + limit - 1);

  const result = await query;
  return normalizeResponse(result);
}

export async function fetchCommentsWithPagination({
  postId,
  limit = 20,
  offset = 0,
  status = "published"
} = {}) {
  let query = supabase
    .from("comments")
    .select("*")
    .eq("post_id", postId);

  if (status) query = query.eq("status", status);

  query = query.order("created_at", { ascending: true });
  query = query.range(offset, offset + limit - 1);

  const result = await query;
  return normalizeResponse(result);
}
