import {supabase,getCurrentUser,signOut,getDisplayName} from "./supabase.js";
import {fetchBookmarks,toggleBookmark} from "./data.js";
import {escapeHTML,isSafeUrl} from "./utils.js";
import "./nav.js";
const $=id=>document.getElementById(id);
const escape=value=>escapeHTML(String(value??""));
let user=null;
let bookmarks=new Set();
const articleUrl=post=>post?.id?"post.html?id="+encodeURIComponent(post.id):"index.html";
function showStatus(message){$("myTechNotice").textContent=message;}
function articleDate(value){
 if(!value)return "Date unavailable";
 const date=new Date(String(value).endsWith("Z")?value:String(value).replace(" ","T")+"Z");
 return Number.isFinite(date.getTime())?date.toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"}):"Date unavailable";
}
function renderAuth(){
 const host=$("authActions");host.replaceChildren();
 if(!user){const link=document.createElement("a");link.className="forum-button secondary";link.href="login.html?next=my-tech.html";link.textContent="Sign in";host.append(link);return;}
 const profile=document.createElement("a");profile.href="profile.html";
 profile.textContent=getDisplayName(user);profile.className="forum-account-link";host.append(profile);
 const button=document.createElement("button");button.type="button";button.className="forum-signout";button.textContent="Log out";
 button.onclick=async()=>{await signOut();location.href="my-tech.html";};host.append(button);
}
async function loadLibrary(){
 const host=$("myTechLibrary");
 if(!user){host.innerHTML="<p class='forum-muted'>Sign in to keep articles across devices.</p><a href='login.html?next=my-tech.html'>Sign in to see bookmarks</a>";return;}
 const items=await fetchBookmarks(user.id);
 bookmarks=new Set(items.map(x=>x.post_id));
 host.innerHTML=items.length?items.slice(0,20).map(item=>{
  const post=item.posts;if(!post)return "";
  return "<article class='my-tech-library-item'><a href='"+articleUrl(post)+"'>"+
   escape(post.title||"Saved article")+"</a><small>Saved "+escape(articleDate(item.created_at))+"</small></article>";
 }).join(""):"<p class='forum-muted'>You haven't saved any articles yet. Save a useful read from the brief.</p>";
}
async function loadBrief(){
 const host=$("myTechBriefStories");host.innerHTML="<p class='forum-muted'>Finding five published stories…</p>";
 const {data,error}=await supabase.rpc("my_tech_brief",{p_limit:5});
 if(error){host.innerHTML="<p class='forum-muted'>Briefing unavailable. Please try again.</p>";showStatus(error.message);return;}
 const posts=data||[];
 $("myTechBriefDate").textContent="Updated "+new Date().toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"});
 host.innerHTML=posts.length?posts.map((post,index)=>{
  const cover=isSafeUrl(post.cover)?"<img src='"+escape(post.cover)+"' alt='' loading='lazy' decoding='async'>":"";
  const teaser=String(post.teaser||"").trim().slice(0,260);
  return "<article class='my-tech-story'><div class='my-tech-story-number'>"+String(index+1).padStart(2,"0")+"</div>"+
   "<div class='my-tech-story-content'><div class='my-tech-story-meta'>"+
   escape(post.category_name||"Technology")+" · "+escape(articleDate(post.created_at))+
   (post.interest_match?" · Matches your interests":"")+"</div>"+
   "<h3><a href='"+articleUrl(post)+"'>"+escape(post.title||"Tech story")+"</a></h3>"+
   (teaser?"<p>"+escape(teaser)+(teaser.length>=260?"…":"")+"</p>":"")+
   "<div class='my-tech-story-actions'><a href='"+articleUrl(post)+"'>Read article ↗</a>"+
   (user?"<button type='button' data-toggle-article='"+escape(post.id)+"' aria-pressed='"+bookmarks.has(post.id)+"'>"+
     (bookmarks.has(post.id)?"★ Saved":"☆ Save")+"</button>":"")+
   "</div></div>"+cover+"</article>";
 }).join(""):"<p class='forum-muted'>There aren't any published articles in the brief yet. Explore the community feed while new stories are prepared.</p>";
}
async function toggleArticle(id){
 if(!user)return;
 const result=await toggleBookmark(id,user.id);
 if(result.saved)bookmarks.add(id);else bookmarks.delete(id);
 document.querySelectorAll("[data-toggle-article='"+id+"']").forEach(button=>{
  button.textContent=result.saved?"★ Saved":"☆ Save";
  button.setAttribute("aria-pressed",String(result.saved));
 });
 await loadLibrary();
 showStatus(result.saved?"Saved to your library.":"Removed from saved articles.");
}
async function boot(){
 try{user=await getCurrentUser();}catch(e){console.warn("My Tech account unavailable",e);}
 renderAuth();await loadLibrary();await loadBrief();
 $("myTechRefresh").addEventListener("click",()=>void loadBrief());
 $("myTechBriefStories").addEventListener("click",event=>{
  const button=event.target.closest("[data-toggle-article]");
  if(button)void toggleArticle(button.dataset.toggleArticle);
 });
}
boot().catch(error=>{console.error("My Tech failed",error);showStatus("Unable to load My Tech right now.");});
