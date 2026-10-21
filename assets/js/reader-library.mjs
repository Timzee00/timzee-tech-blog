import {getContinueReading,forgetReadingEntry,getReadingPreference,safeArticleHref}
 from "./reader-journey.mjs";

/* Your Saved tab is the durable entry point for a private reading journey.
 * Never render history while viewing somebody else's profile. */
export function mountReadingLibrary(user){
  const list=document.getElementById("profileReadingList");
  const status=document.getElementById("profileReadingStatus");
  if(!list||!status||!user?.id)return;
  let busy=false,confirming=false;
  const message=text=>{status.textContent=text;};
  const refresh=async()=>{
    if(busy)return;
    busy=true;
    message("Loading private reading positions…");
    try{
      const allowed=await getReadingPreference(user);
      list.replaceChildren();
      if(!allowed){
        message("Reading history is paused. You can enable it in Settings.");
        return;
      }
      const rows=await getContinueReading(user.id,8);
      if(!rows.length){
        message("No unfinished articles yet. Read an article and your progress will appear here.");
        return;
      }
      const cards=document.createDocumentFragment();
      for(const row of rows){
        const href=safeArticleHref(row.id);
        if(!href)continue;
        const card=document.createElement("article");
        card.className="tz-reader-library-item";
        const link=document.createElement("a");
        link.href=href+"&resume=1";
        link.className="tz-reader-library-title";
        link.textContent=row.title;
        const progress=document.createElement("progress");
        progress.className="tz-reader-card-progress";
        progress.max=100;progress.value=row.percent;
        progress.setAttribute("aria-label",row.percent+" percent read");
        const detail=document.createElement("span");
        detail.className="tz-reader-card-progress-text";
        detail.textContent=row.percent+"% complete · "+row.author;
        const forget=document.createElement("button");
        forget.className="btn ghost sm";
        forget.type="button";
        forget.textContent="Forget position";
        forget.setAttribute("aria-label","Forget reading position for "+row.title.slice(0,100));
        forget.dataset.readingId=row.id;
        card.append(link,detail,progress,forget);
        cards.append(card);
      }
      list.append(cards);
      message("Only you can see these reading positions.");
    }catch(error){
      list.replaceChildren();
      message("Reading history is unavailable right now. Please retry.");
      console.warn("Reading library unavailable",error?.message||"network");
    }finally{busy=false;}
  };
  list.addEventListener("click",async event=>{
    const button=event.target.closest("button[data-reading-id]");
    if(!button||busy||confirming)return;
    const id=button.dataset.readingId;
    const prompt="Forget this article's reading position? This does not remove your bookmark.";
    let approved=false;
    confirming=true;
    try{
      approved=window.appUI?.confirm
        ?await window.appUI.confirm(prompt):window.confirm(prompt);
    }catch(error){
      message("Could not open confirmation. Please retry.");
      return;
    }finally{confirming=false;}
    if(!approved||busy)return;
    busy=true;button.disabled=true;
    message("Removing reading position…");
    try{
      await forgetReadingEntry(user.id,id);
      busy=false;
      await refresh();
    }catch(error){
      busy=false;button.disabled=false;
      message("Could not remove the position. Please retry.");
      console.warn("Reading position deletion failed",error?.message||"network");
    }
  });
  void refresh();
}
