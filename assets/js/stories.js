import { supabase } from "./supabase.js";
import { uploadMedia } from "./media.js";

// Bounded, RLS-filtered status discovery; stable cursor preserves timestamp ties.
const STORY_PAGE_SIZE=72;
const STORY_FIELDS="id, user_id, media_url, media_type, caption, visibility, created_at, expires_at, allow_reshare, allow_public_comments, original_story_id, music_url, music_title";
const STORY_UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const STORY_DATE=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/;
export async function fetchStoriesFeedPage({limit=STORY_PAGE_SIZE,cursor=null}={}){
 const pageSize=Math.max(1,Math.min(STORY_PAGE_SIZE,Number(limit)||STORY_PAGE_SIZE));
 let query=supabase.from("stories").select(STORY_FIELDS)
  .order("created_at",{ascending:false}).order("id",{ascending:false}).limit(pageSize+1);
 if(cursor!==null){
  if(!STORY_UUID.test(cursor.id||"")||!STORY_DATE.test(cursor.created_at||""))throw Error("Invalid status feed cursor.");
  query=query.or(`created_at.lt.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.lt.${cursor.id})`);
 }
 const {data,error}=await query;
 if(error)throw error;
 const rows=(data||[]).slice(0,pageSize);
 const hasMore=(data||[]).length>pageSize;
 const last=rows[rows.length-1];
 const nextCursor=hasMore&&last?{created_at:last.created_at,id:last.id}:null;
 if(!rows.length)return {groups:[],hasMore:false,nextCursor:null};
 const userIds=[...new Set(rows.map(row=>row.user_id).filter(id=>STORY_UUID.test(id||"")))];
 const profilesResult=userIds.length?await supabase.from("public_profiles")
  .select("id, display_name, username, avatar_url, is_verified").in("id",userIds):{data:[],error:null};
 if(profilesResult.error)throw profilesResult.error;
 const profileMap=new Map((profilesResult.data||[]).map(profile=>[profile.id,profile]));
 const grouped=new Map();
 for(const row of rows){
  if(!grouped.has(row.user_id))grouped.set(row.user_id,{userId:row.user_id,profile:profileMap.get(row.user_id)||null,stories:[]});
  grouped.get(row.user_id).stories.push(row);
 }
 // Newest authors first, but show each author's sequence oldest to newest.
 const groups=[...grouped.values()];
 for(const group of groups)group.stories.reverse();
 return {groups,hasMore,nextCursor};
}
// Backwards-compatible grouped-list API.
export async function fetchStoriesFeed(){return (await fetchStoriesFeedPage()).groups;}

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
const PRIVATE_STORY_BUCKET="story-private-media";
function privateStoryPath(source,userId){
 const prefix=PRIVATE_STORY_BUCKET+"/"+userId+"/";
 const value=String(source||"");
 if(!value.startsWith(prefix)||value.includes("..")||value.includes("\\"))return "";
 return value.slice(PRIVATE_STORY_BUCKET.length+1);
}
async function uploadPrivateStoryMedia(file,userId,{music=false}={}){
 if(!userId||!file)throw Error("Private status upload requires an account and a file.");
 if(file.size<1||file.size>50*1024*1024)throw Error("Private status files must be under 50 MB.");
 const ext=String(file.name||"").split(".").at(-1)?.toLowerCase()||"";
 if(!/^[a-z0-9]{2,6}$/.test(ext))throw Error("Unsupported file extension.");
 const path=userId+"/"+(music?"music/":"")+crypto.randomUUID()+"."+ext;
 const {error}=await supabase.storage.from(PRIVATE_STORY_BUCKET).upload(path,file,{
   upsert:false,cacheControl:"300",contentType:file.type||undefined
 });
 if(error)throw Error(error.message||"Unable to store private status.");
 return PRIVATE_STORY_BUCKET+"/"+path;
}
async function cleanupFailedStoryUploads(urls,userId){
 const publicPaths=urls.map(url=>ownedStoryStoragePath(url,userId)).filter(Boolean);
 const privatePaths=urls.map(url=>privateStoryPath(url,userId)).filter(Boolean);
 if(publicPaths.length){
   const {error}=await supabase.storage.from("media").remove(publicPaths);
   if(error)console.warn("Could not clean up public status upload",error.message);
 }
 if(privatePaths.length){
   const {error}=await supabase.storage.from(PRIVATE_STORY_BUCKET).remove(privatePaths);
   if(error)console.warn("Could not clean up private status upload",error.message);
 }
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
  let stage="uploading your status";
  try{
    const privateStory=visibility==="private";
    const mediaUrl=privateStory
      ?await uploadPrivateStoryMedia(file,userId)
      :await uploadMedia(file,`stories/${userId}`);
    if(!mediaUrl)throw Error("Status media upload failed.");
    uploaded.push(mediaUrl);
    let musicUrl=null;
    if(musicFile){
      stage="uploading the soundtrack";
      musicUrl=privateStory
        ?await uploadPrivateStoryMedia(musicFile,userId,{music:true})
        :await uploadMedia(musicFile,`stories/${userId}/music`);
      if(!musicUrl)throw Error("Soundtrack upload failed.");
      uploaded.push(musicUrl);
    }
    stage="publishing your status";
    // Publishing uses the server clock and validates the creator's account.
    const {data,error}=await supabase.rpc("publish_story",{
      p_media_url:mediaUrl,
      p_media_type:file.type?.startsWith("video")?"video":"image",
      p_caption:caption.trim()||null,
      p_visibility:visibility==="private"?"private":"public",
      p_duration_hours:Number(durationHours)||24,
      p_allow_reshare:Boolean(allowReshare),
      p_allow_public_comments:Boolean(allowPublicComments),
      p_music_url:musicUrl,
      p_music_title:musicUrl?musicTitle.trim():null,
      p_music_rights_confirmed:Boolean(musicUrl&&musicRightsConfirmed)
    });
    if(error)throw error;
    return {data,error:null};
  }catch(error){
    const detail=String(error?.message||"");
    const networkFailure=/failed to fetch|networkerror|network request failed|load failed|fetch failed|failed to connect/i.test(detail);
    // If publication's response is lost, the server may have created the
    // status. Do not delete its uploaded media and leave a broken story behind.
    if(stage!=="publishing your status"||!networkFailure)
      await cleanupFailedStoryUploads(uploaded,userId);
    const interrupted=typeof navigator!=="undefined"&&navigator.onLine===false;
    const message=(networkFailure||interrupted)
      ? "Could not reach Blipmood while "+stage+". Check your connection and try again. Your media and caption are still here."
      : detail||"Status upload failed. Please try again.";
    console.warn("Story error during "+stage,error);
    return {error:{message}};
  }
}

export async function deleteStory(storyId) {
  const {data,error}=await supabase.from("stories")
    .delete().eq("id",storyId).select("user_id,media_url,music_url").maybeSingle();
  if(error)return {data:null,error};
  if(data)await cleanupFailedStoryUploads([data.media_url,data.music_url].filter(Boolean),data.user_id);
  return {data,error:null};
}
