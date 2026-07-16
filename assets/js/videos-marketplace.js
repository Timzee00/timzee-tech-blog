import { supabase } from "./supabase.js";

// ============================================================================
// VIDEO FUNCTIONS
// ============================================================================

function getUploadOptions(file, fallbackContentType) {
  return {
    cacheControl: "3600",
    upsert: false,
    contentType: file?.type || fallbackContentType
  };
}

function toSafeFileName(name = "") {
  return String(name || "file")
    .replace(/[^\w.\-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export async function detectVideoDuration(file) {
  if (!file) return 0;
  try {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";

    const duration = await new Promise((resolve, reject) => {
      const cleanup = () => {
        video.removeAttribute("src");
        video.load();
        URL.revokeObjectURL(objectUrl);
      };

      video.onloadedmetadata = () => {
        const seconds = Number.isFinite(video.duration) ? video.duration : 0;
        cleanup();
        resolve(Math.max(0, Math.round(seconds)));
      };

      video.onerror = () => {
        cleanup();
        reject(new Error("Failed to read video duration from selected file."));
      };

      video.src = objectUrl;
    });

    return duration;
  } catch (error) {
    console.warn("detectVideoDuration failed:", error);
    return 0;
  }
}

export async function uploadVideo(userId, authorName, videoFile, thumbnailFile, videoData = {}) {
  if (!userId || !videoFile) return { error: "Missing required fields" };

  try {
    const videoId = crypto.randomUUID();
    const timestamp = Date.now();
    const safeVideoName = toSafeFileName(videoFile.name || "video");
    
    // Upload video to storage
    const videoPath = `videos/${userId}/${timestamp}-${safeVideoName}`;

    const videoResult = await supabase.storage
      .from("media")
      .upload(videoPath, videoFile, getUploadOptions(videoFile, "video/mp4"));
    
    if (videoResult.error) {
      console.error("Storage upload error:", videoResult.error);
      throw new Error(`Storage upload failed: ${videoResult.error.message}`);
    }

    let thumbnailUrl = "";
    
    // Upload thumbnail if provided
    if (thumbnailFile) {
      const safeThumbnailName = toSafeFileName(thumbnailFile.name || "thumbnail.jpg");
      const thumbnailPath = `video-thumbnails/${userId}/${timestamp}-${safeThumbnailName}`;
      const thumbnailResult = await supabase.storage
        .from("media")
        .upload(
          thumbnailPath,
          thumbnailFile,
          getUploadOptions(thumbnailFile, "image/jpeg")
        );

      if (thumbnailResult.error) {
        console.error("Thumbnail upload error:", thumbnailResult.error);
        throw new Error(`Thumbnail upload failed: ${thumbnailResult.error.message}`);
      }

      const { data } = supabase.storage
        .from("media")
        .getPublicUrl(thumbnailPath);
      thumbnailUrl = data.publicUrl;
    }

    // Get public URL for video
    const { data } = supabase.storage
      .from("media")
      .getPublicUrl(videoPath);
    
    const videoUrl = data.publicUrl;

    if (!videoUrl) {
      throw new Error("Failed to get video URL from storage");
    }

    // Save video metadata
    const payload = {
      id: videoId,
      user_id: userId,
      author_name: authorName || "Anonymous",
      title: videoData.title || "Untitled Video",
      description: videoData.description || "",
      video_url: videoUrl,
      thumbnail_url: thumbnailUrl,
      duration: Number(videoData.duration) || 0,
      tags: videoData.tags || [],
      category: videoData.category || "general",
      is_public: videoData.is_public !== false,
      created_at: new Date().toISOString()
    };

    const result = await supabase.from("videos").insert(payload).select().single();
    
    if (result.error) {
      console.error("Insert error:", result.error);
      throw new Error(`Database insert failed: ${result.error.message}`);
    }

    return result;
  } catch (error) {
    console.error("uploadVideo exception:", error);
    return { error: error.message || "Video upload failed" };
  }
}

export async function fetchVideos({ category = null, limit = 20, offset = 0, userId = null } = {}) {
  try {
    let query = supabase
      .from("videos")
      .select("*")
      .eq("is_public", true)
      .order("created_at", { ascending: false });

    if (category) query = query.eq("category", category);
    if (userId) query = query.eq("user_id", userId);

    query = query.range(offset, offset + limit - 1);

    const result = await query;
    if (result && result.error) {
      console.error("fetchVideos error:", result.error);
      return [];
    }
    return result.data || [];
  } catch (err) {
    console.error("fetchVideos exception:", err);
    return [];
  }
}

export async function fetchVideoById(videoId) {
  try {
    const result = await supabase
      .from("videos")
      .select("*")
      .eq("id", videoId)
      .single();
    if (result.error) {
      console.error("fetchVideoById error:", result.error);
      return null;
    }
    return result.data || null;
  } catch (err) {
    console.error("fetchVideoById exception:", err);
    return null;
  }
}

export async function searchVideos({ query, limit = 20, offset = 0 } = {}) {
  if (!query) return [];
  try {
    const result = await supabase
      .from("videos")
      .select("*")
      .textSearch("search_vector", query, { type: "websearch", config: "english" })
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (result && result.error) {
      console.error("searchVideos error:", result.error);
      return [];
    }
    return result.data || [];
  } catch (err) {
    console.error("searchVideos exception:", err);
    return [];
  }
}

export async function likeVideo(videoId, userId) {
  const existing = await supabase
    .from("video_likes")
    .select("id")
    .eq("video_id", videoId)
    .eq("user_id", userId)
    .single();

  if (!existing.error && existing.data) {
    // Already liked, unlike
    await supabase.from("video_likes").delete().eq("id", existing.data.id);
    return { liked: false };
  }

  // Like video
  await supabase.from("video_likes").insert({
    id: crypto.randomUUID(),
    video_id: videoId,
    user_id: userId,
    created_at: new Date().toISOString()
  });

  return { liked: true };
}

export async function getVideoLikeCount(videoId) {
  try {
    const result = await supabase
      .from("video_likes")
      .select("id", { count: "exact", head: true })
      .eq("video_id", videoId);
    if (result && result.error) {
      console.error("getVideoLikeCount error:", result.error);
      return 0;
    }
    return result.count || 0;
  } catch (err) {
    console.error("getVideoLikeCount exception:", err);
    return 0;
  }
}

export async function isVideoLiked(videoId, userId) {
  if (!userId) return false;
  try {
    const result = await supabase
      .from("video_likes")
      .select("id")
      .eq("video_id", videoId)
      .eq("user_id", userId)
      .single();
    if (result && result.error) {
      console.error("isVideoLiked error:", result.error);
      return false;
    }
    return !!result.data;
  } catch (err) {
    console.error("isVideoLiked exception:", err);
    return false;
  }
}

export async function commentOnVideo(videoId, userId, authorName, body, replyTo = null) {
  return supabase.from("video_comments").insert({
    id: crypto.randomUUID(),
    video_id: videoId,
    user_id: userId,
    author_name: authorName,
    body,
    reply_to: replyTo,
    created_at: new Date().toISOString()
  }).select().single();
}

export async function getVideoComments(videoId) {
  try {
    const result = await supabase
      .from("video_comments")
      .select("*")
      .eq("video_id", videoId)
      .order("created_at", { ascending: true });
    if (result && result.error) {
      console.error("getVideoComments error:", result.error);
      return [];
    }
    return result.data || [];
  } catch (err) {
    console.error("getVideoComments exception:", err);
    return [];
  }
}

export async function incrementVideoView(videoId) {
  const video = await fetchVideoById(videoId);
  if (video) {
    await supabase
      .from("videos")
      .update({ view_count: (video.view_count || 0) + 1 })
      .eq("id", videoId);
  }
}

export async function updateVideo(videoId, userId, updates) {
  try {
    return await supabase
      .from("videos")
      .update(updates)
      .eq("id", videoId)
      .eq("user_id", userId)
      .select()
      .single();
  } catch (err) {
    console.error("updateVideo exception:", err);
    return { error: err };
  }
}

export async function deleteVideo(videoId, userId) {
  try {
    return await supabase
      .from("videos")
      .delete()
      .eq("id", videoId)
      .eq("user_id", userId);
  } catch (err) {
    console.error("deleteVideo exception:", err);
    return { error: err };
  }
}

// ============================================================================
// MARKETPLACE FUNCTIONS
// ============================================================================

export async function createMarketplaceItem({
  userId,
  sellerName,
  title,
  description,
  category,
  subcategory,
  price,
  currency = "USD",
  condition,
  location,
  images = []
} = {}) {
  try {
    return await supabase.from("marketplace_items").insert({
    id: crypto.randomUUID(),
    user_id: userId,
    seller_name: sellerName,
    title,
    description,
    category,
    subcategory,
    price,
    currency,
    condition,
    location,
    images,
    is_available: true,
    created_at: new Date().toISOString(),
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString() // 30 days
    }).select().single();
  } catch (err) {
    console.error("createMarketplaceItem exception:", err);
    return { error: err };
  }
}

export async function fetchMarketplaceItems({ 
  category = null, 
  limit = 20, 
  offset = 0,
  userId = null,
  onlyAvailable = true
} = {}) {
  try {
    let query = supabase
      .from("marketplace_items")
      .select("*")
      .order("created_at", { ascending: false });

    if (onlyAvailable) query = query.eq("is_available", true);
    if (category) query = query.eq("category", category);
    if (userId) query = query.eq("user_id", userId);

    query = query.range(offset, offset + limit - 1);

    const result = await query;
    if (result && result.error) {
      console.error("fetchMarketplaceItems error:", result.error);
      return [];
    }
    return result.data || [];
  } catch (err) {
    console.error("fetchMarketplaceItems exception:", err);
    return [];
  }
}

export async function searchMarketplace({ query, category = null, limit = 20, offset = 0 } = {}) {
  if (!query) return [];
  try {
    let request = supabase
      .from("marketplace_items")
      .select("*")
      .textSearch("search_vector", query, { type: "websearch", config: "english" })
      .eq("is_available", true)
      .order("created_at", { ascending: false });

    if (category) request = request.eq("category", category);

    request = request.range(offset, offset + limit - 1);
    const result = await request;
    if (result && result.error) {
      console.error("searchMarketplace error:", result.error);
      return [];
    }
    return result.data || [];
  } catch (err) {
    console.error("searchMarketplace exception:", err);
    return [];
  }
}

export async function getMarketplaceItemById(itemId) {
  try {
    const result = await supabase
      .from("marketplace_items")
      .select("*")
      .eq("id", itemId)
      .single();
    if (result && result.error) {
      console.error("getMarketplaceItemById error:", result.error);
      return null;
    }
    return result.data || null;
  } catch (err) {
    console.error("getMarketplaceItemById exception:", err);
    return null;
  }
}

export async function createMarketplaceInquiry({
  itemId,
  buyerId,
  sellerId = null,
  buyerName,
  message
} = {}) {
  return supabase.from("marketplace_inquiries").insert({
    id: crypto.randomUUID(),
    item_id: itemId,
    buyer_id: buyerId,
    seller_id: sellerId,
    buyer_name: buyerName || "Buyer",
    message,
    status: "pending",
    created_at: new Date().toISOString()
  }).select().single();
}

export async function getMarketplaceInquiries({ itemId = null, buyerId = null }) {
  let query = supabase.from("marketplace_inquiries").select("*");

  if (itemId) query = query.eq("item_id", itemId);
  if (buyerId) query = query.eq("buyer_id", buyerId);

  const result = await query.order("created_at", { ascending: false });
  return result.data || [];
}

export async function updateInquiryStatus(inquiryId, status) {
  return supabase
    .from("marketplace_inquiries")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", inquiryId)
    .select()
    .single();
}

export async function createMarketplaceTransaction({
  itemId,
  sellerId,
  buyerId,
  amount
} = {}) {
  return supabase.from("marketplace_transactions").insert({
    id: crypto.randomUUID(),
    item_id: itemId,
    seller_id: sellerId,
    buyer_id: buyerId,
    amount,
    status: "pending",
    created_at: new Date().toISOString()
  }).select().single();
}

export async function createMarketplaceReview({
  transactionId,
  reviewerId,
  revieweeId,
  rating,
  comment
} = {}) {
  return supabase.from("marketplace_reviews").insert({
    id: crypto.randomUUID(),
    transaction_id: transactionId,
    reviewer_id: reviewerId,
    reviewee_id: revieweeId,
    rating,
    comment,
    created_at: new Date().toISOString()
  }).select().single();
}

export async function getSellerReviews(userId) {
  const result = await supabase
    .from("marketplace_reviews")
    .select("*")
    .eq("reviewee_id", userId)
    .order("created_at", { ascending: false });

  return result.data || [];
}

export async function getSellerRating(userId) {
  const reviews = await getSellerReviews(userId);
  if (reviews.length === 0) return null;
  
  const average = reviews.reduce((sum, r) => sum + (Number(r.rating) || 0), 0) / reviews.length;
  const rounded = Number(average.toFixed(1));
  return {
    rating: rounded,
    reviewCount: reviews.length,
    average_rating: rounded,
    total_reviews: reviews.length
  };
}

export async function updateMarketplaceItem(itemId, userId, updates) {
  return supabase
    .from("marketplace_items")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", itemId)
    .eq("user_id", userId)
    .select()
    .single();
}

export async function deleteMarketplaceItem(itemId, userId) {
  return supabase
    .from("marketplace_items")
    .delete()
    .eq("id", itemId)
    .eq("user_id", userId);
}

export async function incrementMarketplaceView(itemId) {
  const item = await getMarketplaceItemById(itemId);
  if (item) {
    await supabase
      .from("marketplace_items")
      .update({ view_count: (item.view_count || 0) + 1 })
      .eq("id", itemId);
  }
}

export default {
  uploadVideo,
  fetchVideos,
  fetchVideoById,
  searchVideos,
  likeVideo,
  getVideoLikeCount,
  isVideoLiked,
  commentOnVideo,
  getVideoComments,
  incrementVideoView,
  updateVideo,
  deleteVideo,
  createMarketplaceItem,
  fetchMarketplaceItems,
  searchMarketplace,
  getMarketplaceItemById,
  createMarketplaceInquiry,
  getMarketplaceInquiries,
  updateInquiryStatus,
  createMarketplaceTransaction,
  createMarketplaceReview,
  getSellerReviews,
  getSellerRating,
  updateMarketplaceItem,
  deleteMarketplaceItem,
  incrementMarketplaceView
};
