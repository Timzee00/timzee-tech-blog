/* Reader hub: useful return visits instead of notification spam.
   Loads only after the public homepage has rendered. */
import {getContinueReading,getFollowingArticles,safeArticleHref} from "./reader-journey.mjs";
import {supabase} from "./supabase.js";
import {loadUserPreferences} from "./user-preferences.js";
import {recommendForInterests} from "./reader-interest-ranker.mjs";
const $=id=>document.getElementById(id);
const node=(tag,className="",label="")=>{
  const el=document.createElement(tag);
  if(className)el.className=className;
  if(label)el.textContent=label;
  return el;
};
const safeCover=value=>{
  const url=String(value||"");
  return (/^https:\/\/[^<>"'\\\s]+$/i.test(url)||/^\/?assets\/[^<>"'\\\s]+$/i.test(url))
    ?url:null;
};
function card(item,{resume=false,recommendation=false}={}){
  const url=safeArticleHref(item.id);
  if(!url)return null;
  const link=node("a","tz-reader-card");
  link.href=url+(resume?"&resume=1":"");
  const cover=safeCover(item.cover);
  if(cover){
    const image=node("img","tz-reader-card-image");
    image.src=cover;image.alt="";image.loading="lazy";image.decoding="async";
    link.append(image);
  }else{
    const fallback=node("span","tz-reader-card-placeholder","t.");
    fallback.setAttribute("aria-hidden","true");
    link.append(fallback);
  }
  const details=node("span","tz-reader-card-content");
  details.append(node("strong","tz-reader-card-title",item.title));
  details.append(node("small","tz-reader-card-byline",item.author));
  if(resume){
    const value=Math.max(0,Math.min(100,Number(item.percent)||0));
    const progress=node("progress","tz-reader-card-progress");
    progress.max=100;progress.value=value;
    progress.setAttribute("aria-label",value+" percent read");
    details.append(progress,node("small","tz-reader-card-progress-text",
      "Continue reading · "+value+"%"));
  }else{
    details.append(node("small","tz-reader-card-progress-text",recommendation?"Matched to your interests":"New from a creator you follow"));
  }
  link.append(details);
  return link;
}
function renderRail(host,items,options){
  host.replaceChildren();
  for(const item of items){
    const el=card(item,options);
    if(el)host.append(el);
  }
  return host.childElementCount;
}
export async function mountReaderHome(user,{posts=[],categories=[]}={}){
  const section=$("readerJourneySection");
  if(!section||!user?.id)return;
  const cont=$("readerContinue"),following=$("readerFollowing"),suggested=$("readerInterests");
  const contSection=$("readerContinueSection"),followingSection=$("readerFollowingSection"),
    interestsSection=$("readerInterestsSection");
  try{
    const [preferences,followed]=await Promise.all([
      loadUserPreferences(user),
      getFollowingArticles(6).catch(error=>{
        console.warn("Followed articles unavailable:",error?.message||"network");
        return [];
      })
    ]);
    const recent=preferences?.privacy?.rememberReading===false?[]:
      await getContinueReading(user.id,6).catch(error=>{
        console.warn("Reading history unavailable:",error?.message||"network");
        return [];
      });
    const interests=preferences?.feed?.showRecommendations===false||!posts?.length?[]:
      await supabase.from("community_user_interests")
        .select("topic").eq("user_id",user.id).limit(14)
        .then(({data,error})=>{
          if(error)throw error;
          return (data||[]).map(item=>item.topic);
        }).catch(error=>{
          console.warn("Reading interests unavailable:",error?.message||"network");
          return [];
        });
    const usedIds=[...recent,...followed].map(item=>item.id);
    const suggestedPosts=recommendForInterests(posts,interests,categories,usedIds,4)
      .map(item=>({id:item.id,title:item.title,author:item.author_name,cover:item.cover}));
    const countContinue=renderRail(cont,recent,{resume:true});
    const countFollowing=renderRail(following,followed,{resume:false});
    const countInterests=renderRail(suggested,suggestedPosts,{recommendation:true});
    contSection.hidden=!countContinue;
    followingSection.hidden=!countFollowing;
    interestsSection.hidden=!countInterests;
    section.hidden=false;
    const empty=$("readerJourneyEmpty");
    if(empty)empty.hidden=Boolean(countContinue||countFollowing||countInterests);
    const library=$("readerBookmarksLink");
    if(library)library.href="profile.html?id="+encodeURIComponent(user.id)+"&tab=bookmarks";
  }catch(error){
    console.warn("Reader home could not be mounted:",error?.message||"network");
    section.hidden=true;
  }
}
