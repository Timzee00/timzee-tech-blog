/* Private reading continuity and the existing creator-follow graph.
 * One query per feature, narrow columns, no third-party analytics or tracking. */
import {supabase} from "./supabase.js";
import {loadUserPreferences} from "./user-preferences.js";
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const BOUND=8;
export const safeArticleHref=id=>UUID.test(String(id||""))
  ? "/post.html?id="+encodeURIComponent(id):null;
export const percentBound=value=>Math.max(0,Math.min(100,Math.round(Number(value)||0)));

export async function getContinueReading(userId,limit=6){
  if(!UUID.test(String(userId||"")))return [];
  const size=Math.max(1,Math.min(BOUND,Math.trunc(Number(limit)||6)));
  const {data,error}=await supabase.from("article_reading_progress")
    .select("post_id,progress_percent,last_read_at,posts!inner(id,title,cover,slug,author_name,status,publish_at)")
    .eq("user_id",userId).is("completed_at",null)
    .eq("posts.status","published")
    .order("last_read_at",{ascending:false}).limit(size);
  if(error)throw error;
  const now=Date.now();
  return (data||[]).filter(row=>{
    const publication=row.posts?.publish_at;
    // PostgreSQL publish_at is UTC timestamp-without-timezone. A naked
    // JavaScript Date parse would interpret it in the reader's local zone.
    const raw=String(publication||"").trim().replace(" ","T");
    const hasOffset=raw.toUpperCase().endsWith("Z")||raw.includes("+",10)||raw.includes("-",10);
    const published=raw?Date.parse(hasOffset?raw:raw+"Z"):0;
    return row.posts?.id===row.post_id&&
      (!raw||(Number.isFinite(published)&&published<=now))&&
      percentBound(row.progress_percent)<95;
  }).map(row=>({
    id:row.post_id,title:String(row.posts.title||"Untitled article"),
    author:String(row.posts.author_name||"Timzee community"),
    cover:row.posts.cover||null,
    percent:percentBound(row.progress_percent),
    lastReadAt:row.last_read_at
  }));
}

export async function getFollowingArticles(limit=6){
  const size=Math.max(1,Math.min(BOUND,Math.trunc(Number(limit)||6)));
  const {data,error}=await supabase.rpc("reader_following_articles",{p_limit:size});
  if(error)throw error;
  return (data||[]).filter(row=>UUID.test(String(row.post_id||"")))
    .map(row=>({
      id:row.post_id,title:String(row.title||"Untitled article"),
      author:String(row.author_name||"Community creator"),
      cover:row.cover||null,
      createdAt:row.created_at
    }));
}

export async function forgetReadingEntry(userId,postId=null){
  if(!UUID.test(String(userId||"")))throw Error("Please sign in first.");
  if(postId!==null&&!UUID.test(String(postId)))throw Error("Invalid article.");
  let query=supabase.from("article_reading_progress").delete().eq("user_id",userId);
  if(postId!==null)query=query.eq("post_id",postId);
  const {error}=await query;
  if(error)throw error;
}

/* The browser sends only rough integer completion (1-100); the database
 * verifies authentication, post visibility, preferences and write quotas. */
export async function recordReading(postId,percent){
  if(!UUID.test(String(postId||"")))return false;
  const progress=percentBound(percent);
  if(progress<1)return false;
  const {data,error}=await supabase.rpc("record_article_reading",{
    p_post_id:postId,p_percent:progress
  });
  if(error)throw error;
  return data===true;
}
export async function getReadingPreference(user){
  if(!user?.id)return false;
  const preferences=await loadUserPreferences(user);
  return preferences?.privacy?.rememberReading!==false;
}

function scrollPercent(element){
  if(!element?.isConnected)return 0;
  const top=element.getBoundingClientRect().top+window.scrollY;
  const height=Math.max(1,element.getBoundingClientRect().height);
  const edge=window.scrollY+window.innerHeight*0.82;
  if(edge<=top)return 0;
  return percentBound((edge-top)/height*100);
}
export function mountArticleJourney({post,user}={}){
  const body=document.getElementById("postContent");
  if(!user?.id||!UUID.test(String(post?.id||""))||!body)return;
  let disposed=false,configured=false,writing=false,queued=0,lastSent=0,lastAttempt=0,failedSaves=0;
  let flushTimer=null;
  let progressUI=null,progressBar=null,progressText=null;
  const updateUI=value=>{
    if(!progressBar||!progressText)return;
    const p=percentBound(value);
    progressBar.value=p;
    progressText.textContent=p>=95?"You've reached the end of this article":
      p+"% through this article";
  };
  const flush=async()=>{
    if(disposed||!configured||writing)return;
    const p=queued;
    if(p<=0||p<=lastSent||(p<95&&p<lastSent+5&&Date.now()-lastAttempt<20000))return;
    writing=true;lastAttempt=Date.now();
    try{
      await recordReading(post.id,p);
      lastSent=Math.max(lastSent,p);
      failedSaves=0;
    }catch(error){
      // Retry transient failures only a few times; don't poll offline forever.
      failedSaves++;
      console.warn("Reading progress could not sync:",error?.message||"network");
    }finally{
      writing=false;
      if(!disposed&&queued>lastSent&&failedSaves<3&&flushTimer===null){
        flushTimer=window.setTimeout(()=>{
          flushTimer=null;
          void flush();
        },20000);
      }
    }
  };
  const onScroll=()=>{
    if(disposed||!configured)return;
    const percent=scrollPercent(body);
    if(percent<=0)return;
    queued=Math.max(queued,percent);
    updateUI(queued);
    if(flushTimer===null){
      flushTimer=window.setTimeout(()=>{
        flushTimer=null;
        void flush();
      },1500);
    }
  };
  const visibility=()=>{
    if(document.visibilityState==="hidden"&&queued>lastSent)void flush();
  };
  const destroy=()=>{
    disposed=true;
    if(flushTimer!==null)window.clearTimeout(flushTimer);
    window.removeEventListener("scroll",onScroll);
    document.removeEventListener("visibilitychange",visibility);
    window.removeEventListener("pagehide",destroy);
  };
  window.addEventListener("pagehide",destroy,{once:true});
  void (async()=>{
    try{
      if(!await getReadingPreference(user)||disposed)return;
      const {data,error}=await supabase.from("article_reading_progress")
        .select("progress_percent,completed_at")
        .eq("user_id",user.id).eq("post_id",post.id).maybeSingle();
      if(error)throw error;
      if(disposed)return;
      const saved=percentBound(data?.progress_percent||0);
      lastSent=saved;
      queued=saved;
      progressUI=document.createElement("section");
      progressUI.className="tz-reading-position";
      progressUI.setAttribute("aria-label","Private reading progress");
      const top=document.createElement("div");
      top.className="tz-reading-position-heading";
      const label=document.createElement("strong");
      label.textContent="Your reading journey";
      progressText=document.createElement("span");
      top.append(label,progressText);
      progressBar=document.createElement("progress");
      progressBar.max=100;
      progressBar.value=saved;
      progressBar.setAttribute("aria-label","Article progress");
      progressUI.append(top,progressBar);
      const info=document.createElement("small");
      info.textContent="Private to your account · Manage in Settings";
      progressUI.append(info);
      if(saved>=5&&saved<95&&!data.completed_at){
        const resume=document.createElement("button");
        resume.type="button";
        resume.className="btn ghost sm";
        resume.textContent="Continue from "+saved+"%";
        resume.addEventListener("click",()=>{
          const top=body.getBoundingClientRect().top+window.scrollY;
          const target=top+(body.offsetHeight*saved/100)-window.innerHeight*.44;
          window.scrollTo({top:Math.max(0,target),
            behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"});
          resume.remove();
        });
        progressUI.append(resume);
        // Only links deliberately marked "Continue reading" auto-resume.
        // Keep the button as an accessible fallback if media changes layout.
        if(new URLSearchParams(window.location.search).get("resume")==="1"){
          window.setTimeout(()=>{if(!disposed&&resume.isConnected)resume.click();},500);
        }
      }
      body.before(progressUI);
      configured=true;
      updateUI(saved);
      window.addEventListener("scroll",onScroll,{passive:true});
      document.addEventListener("visibilitychange",visibility);
    }catch(error){
      console.warn("Private reading journey unavailable:",error?.message||"network");
    }
  })();
}
