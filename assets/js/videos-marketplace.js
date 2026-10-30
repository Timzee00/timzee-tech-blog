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

/** Shared video picker validation. */
export function isSupportedVideoFile(file) {
  return Boolean(file?.size && (/^video\//i.test(file.type || "") ||
    /\.(mp4|webm|ogg|ogv|mov|m4v)$/i.test(file.name || "")));
}
/** Robust auto-cover with timeout and cleaned-up object URLs. */
export function captureVideoThumbnail(file, seekTime = 0.5) {
  if (!isSupportedVideoFile(file)) return Promise.resolve(null);
  return new Promise(resolve => {
    let url;
    try { url = URL.createObjectURL(file); } catch { resolve(null); return; }
    const video = document.createElement("video");
    video.preload = "auto"; video.muted = true; video.playsInline = true;
    let done = false, drawing = false;
    const finish = file => {
      if (done) return;
      done = true;
      clearTimeout(timeout);
      video.removeAttribute("src"); video.load();
      URL.revokeObjectURL(url);
      resolve(file);
    };
    const draw = () => {
      if (done || drawing || video.readyState < 2 || !video.videoWidth || !video.videoHeight) return false;
      drawing = true;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth; canvas.height = video.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) { finish(null); return true; }
        ctx.drawImage(video,0,0,canvas.width,canvas.height);
        canvas.toBlob(blob => finish(blob ? new File([blob],"video-cover.jpg",{type:"image/jpeg"}) : null),"image/jpeg",.84);
      } catch { finish(null); }
      return true;
    };
    const timeout = setTimeout(() => { if (!draw() && !drawing) finish(null); },8000);
    video.addEventListener("loadedmetadata", () => {
      const duration=Number.isFinite(video.duration)?video.duration:0;
      const at=Math.min(Math.max(0,Number(seekTime)||0.1),Math.max(0,duration-0.1));
      try { if (at>0.02) video.currentTime=at; else if (video.readyState>=2) draw(); }
      catch { draw(); }
    },{once:true});
    video.addEventListener("seeked",draw);
    video.addEventListener("loadeddata",()=>{if(video.currentTime===0)draw();},{once:true});
    video.addEventListener("error",()=>finish(null),{once:true});
    video.src=url; video.load();
  });
}

export async function uploadVideo(userId, authorName, videoFile, thumbnailFile, videoData = {}) {
  if (!userId || !videoFile) return { error: "Missing required fields" };
  if (!isSupportedVideoFile(videoFile)) return { error: "Please select a non-empty video, not a photo." };
  // Check before uploading bytes. This RPC gives the current allowed limits
  // without exposing private bucket inventory. Server checks again on insert.
  let limits;
  try {
    const [feature,policy]=await Promise.all([
      supabase.rpc("blipmood_feature_allowed",{p_feature:"video_uploads"}),
      supabase.rpc("blipmood_media_upload_policy")
    ]);
    if(feature.error||feature.data!==true) return {error:"Video uploading is unavailable for this account or region."};
    if(policy.error||!policy.data) return {error:"Upload capacity settings are unavailable. Please retry."};
    limits=policy.data;
  }catch{return {error:"Upload capacity check unavailable. Please retry."};}
  const maxVideo=Number(limits.max_video_upload_bytes)||20*1024*1024;
  const maxThumb=Number(limits.max_thumbnail_bytes)||2*1024*1024;
  if(videoFile.size>maxVideo)
    return {error:"Video too large. Please compress it to "+Math.round(maxVideo/1048576)+" MB or less before uploading."};
  if(thumbnailFile && (!String(thumbnailFile.type||"").startsWith("image/")||thumbnailFile.size>maxThumb))
    return {error:"Please use an image cover under "+Math.round(maxThumb/1048576)+" MB."};
  let videoPath=null,thumbnailPath=null,metadataSaved=false;
  try {
    const videoId = crypto.randomUUID();
    const timestamp = Date.now();
    const safeVideoName = toSafeFileName(videoFile.name || "video");
    
    // Upload video to storage
    videoPath = `videos/${userId}/${timestamp}-${safeVideoName}`;

    const videoResult = await supabase.storage
      .from("media")
      .upload(videoPath, videoFile, getUploadOptions(videoFile, "video/mp4"));
    
    if (videoResult.error) {
      console.error("Storage upload error:", videoResult.error);
      throw new Error(`Storage upload failed: ${videoResult.error.message}`);
    }

    let thumbnailUrl = "";
    
    // Both upload routes get the same automatic thumbnail fallback.
    thumbnailFile = thumbnailFile || await captureVideoThumbnail(videoFile);
    if (thumbnailFile) {
      const safeThumbnailName = toSafeFileName(thumbnailFile.name || "thumbnail.jpg");
      thumbnailPath = `video-thumbnails/${userId}/${timestamp}-${safeThumbnailName}`;
      if(thumbnailFile.size>maxThumb)throw Error("Generated cover exceeds the upload image limit.");
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

    // The saved public byline must never contain a real name or email.
    const {data: uploaderProfile}=await supabase.from("public_profiles")
      .select("username").eq("id",userId).maybeSingle();
    const publicUsername=String(uploaderProfile?.username||"").trim();
    // Save video metadata
    const payload = {
      id: videoId,
      user_id: userId,
      author_name: publicUsername || "Member",
      title: videoData.title || "Untitled Video",
      description: videoData.description || "",
      video_url: videoUrl,
      thumbnail_url: thumbnailUrl,
      duration: Number(videoData.duration) || 0,
      tags: videoData.tags || [],
      category: videoData.category || "general",
      is_public: videoData.is_public !== false,
      allow_comments: videoData.allow_comments !== false,
      allow_download: videoData.allow_download !== false,
      created_at: new Date().toISOString()
    };

    const result = await supabase.from("videos").insert(payload).select().single();
    
    if (result.error) {
      console.error("Insert error:", result.error);
      throw new Error(`Database insert failed: ${result.error.message}`);
    }

    metadataSaved=true;
    return result;
  } catch (error) {
    console.error("uploadVideo exception:", error);
    // Do not leave a paid-storage orphan when the metadata insert fails.
    // Only remove paths belonging to this upload, never older user media.
    if(!metadataSaved && videoPath){
      const paths=[videoPath,thumbnailPath].filter(Boolean);
      try{
        const {error:cleanupError}=await supabase.storage.from("media").remove(paths);
        if(cleanupError)console.warn("Orphan upload cleanup needs review:",cleanupError.message);
      }catch(cleanupError){console.warn("Orphan upload cleanup unavailable:",cleanupError?.message);}
    }
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
      throw result.error;
    }
    return result.data || [];
  } catch (err) {
    console.error("fetchVideos exception:", err);
    throw err;
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

export async function searchVideos({ query, category = null, limit = 20, offset = 0 } = {}) {
  if (!query) return [];
  try {
    let request = supabase
      .from("videos")
      .select("*")
      .textSearch("search_vector", query, { type: "websearch", config: "english" })
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    if (category) request = request.eq("category", category);
    const result = await request;
    if (result && result.error) {
      console.error("searchVideos error:", result.error);
      throw result.error;
    }
    return result.data || [];
  } catch (err) {
    console.error("searchVideos exception:", err);
    throw err;
  }
}

export async function likeVideo(videoId, userId) {
  if(!videoId||!userId)return {liked:false,error:{message:"Sign in to like videos."}};
  const existing=await supabase.from("video_likes").select("id")
    .eq("video_id",videoId).eq("user_id",userId).maybeSingle();
  if(existing.error)return {liked:false,error:existing.error};
  if(existing.data){
    const removed=await supabase.from("video_likes").delete()
      .eq("id",existing.data.id).eq("user_id",userId);
    if(removed.error)return {liked:true,error:removed.error};
    return {liked:false};
  }
  const inserted=await supabase.from("video_likes").insert({
    id:crypto.randomUUID(),video_id:videoId,user_id:userId,
    created_at:new Date().toISOString()
  });
  if(inserted.error)return {liked:false,error:inserted.error};
  return {liked:true};
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

const VIDEO_COMMENT_PAGE_SIZE = 40;

// One page at a time. The UI must never request a video's entire comment
// history; the database can return millions of rows for a popular video.
export async function fetchVideoCommentPage(videoId, { offset = 0, limit = VIDEO_COMMENT_PAGE_SIZE } = {}) {
  if (!videoId) return [];
  const pageSize = Math.max(1, Math.min(60, Math.trunc(Number(limit) || VIDEO_COMMENT_PAGE_SIZE)));
  const start = Math.max(0, Math.trunc(Number(offset) || 0));
  const { data, error } = await supabase
    .from("video_comments")
    .select("id,video_id,user_id,author_name,body,reply_to,created_at")
    .eq("video_id", videoId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(start, start + pageSize - 1);
  if (error) throw error;
  return data || [];
}

// Keep legacy callers compatible while bounding their network payloads.
export async function getVideoComments(videoId, options) {
  try {
    return await fetchVideoCommentPage(videoId, options);
  } catch (error) {
    console.error("getVideoComments error:", error);
    return [];
  }
}

// Public videos are not updatable by ordinary viewers (correct RLS).
// Never use client-side read/modify/write counters: it loses concurrent views
// and silently fails for non-owners. The staging-reviewed RPC atomically counts
// at most one authenticated view per user/video/UTC day.
let viewCounterRpcAvailable = true;
export async function incrementVideoView(videoId) {
  if (!videoId) return false;
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData?.session?.user?.id) {
      // Free anonymous receipt: a same-origin Netlify function validates the
      // visible watch and records one hashed guest/video/day. The privileged
      // database key never reaches the browser.
      const reply=await fetch("/.netlify/functions/video-view",{
        method:"POST",
        credentials:"omit",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({videoId})
      });
      if(!reply.ok)return false;
      const result=await reply.json();
      return result?.credited===true;
    }
    if (!viewCounterRpcAvailable) return false;
    const { data, error } = await supabase.rpc("record_video_view", { p_video_id: videoId });
    if (error) {
      if (["PGRST202", "42883"].includes(String(error.code || ""))) {
        viewCounterRpcAvailable = false;
        console.warn("Atomic video view tracking is pending the server migration.");
      } else {
        console.warn("Video view tracking failed:", error);
      }
      return false;
    }
    return data === true;
  } catch (error) {
    console.warn("Video view tracking unavailable:", error);
    return false;
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
      throw result.error;
    }
    const items = result.data || [];
    await attachSellerVerification(items);
    return items;
  } catch (err) {
    console.error("fetchMarketplaceItems exception:", err);
    throw err;
  }
}

// Batch-fetches profiles.is_verified for all sellers in a list of marketplace items
// and attaches it as item.seller_verified — one query total, not one per item.
async function attachSellerVerification(items) {
  const sellerIds = [...new Set(items.map((item) => item.user_id).filter(Boolean))];
  if (!sellerIds.length) return;
  try {
    const result = await supabase
      .from("public_profiles")
      .select("id, is_verified")
      .in("id", sellerIds);
    if (result.error) {
      console.error("attachSellerVerification error:", result.error);
      return;
    }
    const verifiedMap = {};
    (result.data || []).forEach((profile) => {
      verifiedMap[profile.id] = !!profile.is_verified;
    });
    items.forEach((item) => {
      item.seller_verified = !!verifiedMap[item.user_id];
    });
  } catch (err) {
    console.error("attachSellerVerification exception:", err);
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
      throw result.error;
    }
    return result.data || [];
  } catch (err) {
    console.error("searchMarketplace exception:", err);
    throw err;
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
    const item = result.data || null;
    if (item) await attachSellerVerification([item]);
    return item;
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
