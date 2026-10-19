/* Reader hub: useful return visits instead of notification spam.
   Loads only after the public homepage has rendered. */
import {getContinueReading,getFollowingArticles,safeArticleHref,getReadingPreference}
 from "./reader-journey.mjs";
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
function card(item,{resume=false}={}){
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
    details.append(node("small","tz-reader-card-progress-text","New from a creator you follow"));
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
export async function mountReaderHome(user){
  const section=$("readerJourneySection");
  if(!section||!user?.id)return;
  const cont=$("readerContinue"),following=$("readerFollowing");
  const contSection=$("readerContinueSection"),followingSection=$("readerFollowingSection");
  try{
    const [allowed,followed]=await Promise.all([
      getReadingPreference(user).catch(()=>false),
      getFollowingArticles(6).catch(error=>{
        console.warn("Followed articles unavailable:",error?.message||"network");
        return [];
      })
    ]);
    const recent=allowed?await getContinueReading(user.id,6).catch(error=>{
      console.warn("Reading history unavailable:",error?.message||"network");
      return [];
    }):[];
    const countContinue=renderRail(cont,recent,{resume:true});
    const countFollowing=renderRail(following,followed,{resume:false});
    contSection.hidden=!countContinue;
    followingSection.hidden=!countFollowing;
    if(countContinue||countFollowing){
      section.hidden=false;
      const empty=$("readerJourneyEmpty");
      if(empty)empty.hidden=true;
    }else{
      // Offer one practical onboarding route rather than an empty carousel.
      const intro=$("readerJourneyEmpty");
      if(intro)intro.hidden=false;
      section.hidden=false;
    }
    const library=$("readerBookmarksLink");
    if(library)library.href="profile.html?id="+encodeURIComponent(user.id)+"&tab=bookmarks";
  }catch(error){
    console.warn("Reader home could not be mounted:",error?.message||"network");
    section.hidden=true;
  }
}
