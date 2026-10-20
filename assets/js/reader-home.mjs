/* Reader hub: useful return visits instead of notification spam.
   Loads only after the public homepage has rendered. */
import {getContinueReading,getFollowingArticles,safeArticleHref} from "./reader-journey.mjs";
import {supabase} from "./supabase.js";
import {loadUserPreferences,saveUserPreferences} from "./user-preferences.js";
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
function mountWeeklyGoal(section,user,preferences){
  if(!section||!user?.id)return;
  const allowed=[0,2,4,7];
  const wrapper=node("section","tz-reader-weekly-goal");
  wrapper.setAttribute("aria-label","Optional weekly reading goal");
  const header=node("div","tz-reader-goal-heading");
  header.append(node("strong","","Your weekly learning goal"));
  const label=node("label","","Articles per week");
  const select=node("select","");
  select.setAttribute("aria-label","Weekly reading goal");
  for(const [value,text] of [[0,"Off"],[2,"2 articles"],[4,"4 articles"],[7,"7 articles"]]){
    const option=node("option","",text);option.value=String(value);select.append(option);
  }
  const saved=Number(preferences?.feed?.weeklyReadingGoal)||0;
  // Track the last confirmed value, not the initial value: a failed later
  // save must restore the most recently persisted goal.
  let confirmedGoal=allowed.includes(saved)?saved:0;
  select.value=String(confirmedGoal);
  label.append(select);
  header.append(label);
  wrapper.append(header);
  const status=node("p","tz-reader-goal-status");
  status.setAttribute("role","status");
  status.setAttribute("aria-live","polite");
  const progress=node("progress","tz-reader-goal-progress");
  progress.min=0;progress.max=1;progress.value=0;
  wrapper.append(progress,status);
  const refresh=async()=>{
    const goal=Number(select.value);
    if(!goal){progress.hidden=true;status.textContent="No goal set. Read at your own pace.";return;}
    progress.hidden=false;
    status.textContent="Checking completed articles this week…";
    const {data,error}=await supabase.rpc("reader_weekly_completion_count");
    if(error){status.textContent="Your goal is saved. Progress is temporarily unavailable.";return;}
    const completed=Math.max(0,Math.trunc(Number(data)||0));
    progress.max=goal;progress.value=Math.min(goal,completed);
    progress.setAttribute("aria-label",completed+" of "+goal+" articles completed this week");
    status.textContent=completed>=goal?"Weekly goal reached. Nice work!":
      completed+" of "+goal+" articles completed this week";
  };
  let saving=false;
  select.addEventListener("change",async()=>{
    if(saving)return;
    const target=Number(select.value);
    if(!allowed.includes(target))return;
    saving=true;select.disabled=true;status.textContent="Saving your choice…";
    try{
      await saveUserPreferences(user.id,{feed:{weeklyReadingGoal:target}});
      confirmedGoal=target;
      await refresh();
    }catch(error){
      select.value=String(confirmedGoal);
      status.textContent="Could not save your goal. Try again.";
    }finally{saving=false;select.disabled=false;}
  });
  section.prepend(wrapper);
  if(Number(select.value)>0)void refresh();
  else{progress.hidden=true;status.textContent="Optional, private, and free of streak pressure.";}
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
    mountWeeklyGoal(section,user,preferences);
    const empty=$("readerJourneyEmpty");
    if(empty)empty.hidden=Boolean(countContinue||countFollowing||countInterests);
    const library=$("readerBookmarksLink");
    if(library)library.href="profile.html?id="+encodeURIComponent(user.id)+"&tab=bookmarks";
  }catch(error){
    console.warn("Reader home could not be mounted:",error?.message||"network");
    section.hidden=true;
  }
}
