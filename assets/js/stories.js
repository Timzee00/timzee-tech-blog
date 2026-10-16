import { supabase } from "./supabase.js";
import { uploadMedia } from "./media.js";

// Fetches every currently-active (non-expired, visibility-permitted) story
// the current user is allowed to see, grouped by author. RLS already filters
// out expired/private-not-a-friend rows server-side; this just groups them.
export async function fetchStoriesFeed() {
  const result = await supabase
    .from("stories")
    .select("id, user_id, media_url, media_type, caption, visibility, created_at, expires_at, allow_reshare, allow_public_comments, original_story_id, music_url, music_title")
    .order("created_at", { ascending: true });

  if (result.error) {
    console.error("Failed to load stories:", result.error);
    throw result.error;
  }

  const rows = result.data || [];
  const userIds = [...new Set(rows.map((row) => row.user_id))];
  if (!userIds.length) return [];

  const profilesResult = await supabase
    .from("public_profiles")
    .select("id, display_name, avatar_url, is_verified")
    .in("id", userIds);
  if (profilesResult.error) {
    console.error("Failed to load story profiles:", profilesResult.error);
    throw profilesResult.error;
  }

  const profileMap = {};
  (profilesResult.data || []).forEach((profile) => {
    profileMap[profile.id] = profile;
  });

  const grouped = new Map();
  rows.forEach((row) => {
    if (!grouped.has(row.user_id)) {
      grouped.set(row.user_id, {
        userId: row.user_id,
        profile: profileMap[row.user_id] || null,
        stories: []
      });
    }
    grouped.get(row.user_id).stories.push(row);
  });

  return Array.from(grouped.values());
}

export async function fetchUserStories(userId) {
  const result = await supabase
    .from("stories")
    .select("id, user_id, media_url, media_type, caption, visibility, created_at, expires_at, allow_reshare, allow_public_comments, original_story_id, music_url, music_title")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (result.error) {
    console.warn("Failed to load user stories:", result.error);
    return [];
  }
  return result.data || [];
}

const STORY_SOUNDTRACK_TYPES=new Set(["audio/mpeg","audio/mp4","audio/x-m4a","audio/ogg","audio/webm"]);
const STORY_SOUNDTRACK_EXTS=new Set(["mp3","m4a","ogg","webm"]);
const MAX_SOUNDTRACK_BYTES=10*1024*1024;

function ownedStoryStoragePath(publicUrl,userId){
  try{
    const url=new URL(publicUrl);
    const expected=`/storage/v1/object/public/media/stories/${userId}/`;
    if(!url.pathname.startsWith(expected)||!url.hostname.endsWith(".supabase.co"))return "";
    return "stories/"+userId+"/"+decodeURIComponent(url.pathname.slice(expected.length));
  }catch{return "";}
}
async function cleanupFailedStoryUploads(urls,userId){
  const paths=urls.map(url=>ownedStoryStoragePath(url,userId)).filter(Boolean);
  if(!paths.length)return;
  const {error}=await supabase.storage.from("media").remove(paths);
  if(error)console.warn("Could not remove a failed status upload",error.message);
}

export async function createStory({
  userId,file,caption="",visibility="public",durationHours=24,
  allowReshare=true,allowPublicComments=true,
  musicFile=null,musicTitle="",musicRightsConfirmed=false
}={}){
  if(!userId||!file)return {error:{message:"Choose a photo or video to post."}};
  if(musicFile){
    const extension=(musicFile.name||"").split(".").pop().toLowerCase();
    if(!STORY_SOUNDTRACK_TYPES.has(musicFile.type)||!STORY_SOUNDTRACK_EXTS.has(extension)
      ||musicFile.size<1||musicFile.size>MAX_SOUNDTRACK_BYTES)
      return {error:{message:"Soundtrack must be an MP3, M4A, OGG, or WebM file under 10 MB."}};
    if(!musicRightsConfirmed)
      return {error:{message:"Confirm that you own the music or have rights to publish it."}};
    if(!musicTitle.trim()||musicTitle.trim().length>90)
      return {error:{message:"Enter a soundtrack title (up to 90 characters)."}};
  }
  const uploaded=[];
  try{
    const mediaUrl=await uploadMedia(file,`stories/${userId}`);
    if(!mediaUrl)throw Error("Status media upload failed.");
    uploaded.push(mediaUrl);
    let musicUrl=null;
    if(musicFile){
      musicUrl=await uploadMedia(musicFile,`stories/${userId}/music`);
      if(!musicUrl)throw Error("Soundtrack upload failed.");
      uploaded.push(musicUrl);
    }
    const {data,error}=await supabase.from("stories").insert({
      user_id:userId,media_url:mediaUrl,
      media_type:file.type?.startsWith("video")?"video":"image",
      caption:caption.trim()||null,
      visibility:visibility==="private"?"private":"public",
      expires_at:new Date(Date.now()+Math.max(1,Math.min(72,Number(durationHours)||24))*3600000).toISOString(),
      allow_reshare:Boolean(allowReshare),
      allow_public_comments:Boolean(allowPublicComments),
      music_url:musicUrl,music_title:musicUrl?musicTitle.trim():null,
      music_rights_confirmed:Boolean(musicUrl&&musicRightsConfirmed)
    }).select().single();
    if(error)throw error;
    return {data,error:null};
  }catch(error){
    await cleanupFailedStoryUploads(uploaded,userId);
    return {error:{message:error.message||"Status upload failed. Please try again."}};
  }
}

export async function deleteStory(storyId) {
  return supabase.from("stories").delete().eq("id", storyId);
}
