import {supabase,getCurrentUser,getDisplayName,signOut} from "./supabase.js";
import {escapeHTML,timeAgo,reportAppError,isSafeUrl} from "./utils.js";
import {setupMentionInput} from "./mentions.js";
import {renderCommunityMarkdown,insertCommunityFormatting} from "./community-markdown.mjs";
import "./nav.js";

const $=id=>document.getElementById(id);
const escape=value=>escapeHTML(String(value??""));
const validId=value=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(String(value||""));
const categories=["All","AI & ML","Programming","Gadgets","Cybersecurity","Tech Jobs","Gaming","Startups","Learning","Technology","Project Showcase","Sports","Entertainment","World Affairs","General"];
const PAGE_SIZE=20;
const state={
 user:null,platformStaff:false,reportTarget:null,interests:new Set(),communities:[],communityPage:0,hasMoreCommunities:false,
 selectedCategory:"All",communitySearch:"",activeCommunity:null,activeThread:null,
 view:"home",mode:"home",sort:"active",feed:[],feedCursor:null,feedHasMore:false,feedBusy:false,feedVersion:0,search:"",
 joined:new Set(),memberRoles:new Map(),saved:new Set(),votes:new Map(),replyVotes:new Map(),replyVoteBusy:new Set(),
 pinned:[],replies:[],replyCursor:null,repliesHasMore:false,replyTo:null,loadingReplies:false,replyVersion:0,voteBusy:new Set()
};
function notify(message,warning=false){
 const node=$("forumNotice");node.textContent=message;node.hidden=false;
 node.classList.toggle("error",warning);
}
function clearNotice(){$("forumNotice").hidden=true;}
function memberName(){return String(getDisplayName(state.user)||state.user?.user_metadata?.full_name||"Member").slice(0,100);}
function isCommunityStaff(id){return state.platformStaff||["owner","moderator"].includes(state.memberRoles.get(id));}
function mustLogin(){
 if(state.user)return true;
 notify("Sign in to participate. Everyone can browse public communities.",true);
 return false;
}
function setButtonBusy(button,busy){
 if(button)button.disabled=Boolean(busy);
}
function preferredDate(value){try{return timeAgo(value);}catch{return "Recently";}}
function findCommunity(id){return state.communities.find(c=>c.id===id);}
function showDialog(id){
 if(!mustLogin())return;
 const dialog=$(id);
 if(typeof dialog.showModal!=="function"){notify("This browser cannot open the editor.",true);return;}
 if(id==="forumThreadDialog"){
  const options=state.communities.filter(c=>c.community_state==="active");
  $("forumThreadCommunity").innerHTML=options.map(c=>"<option value='"+escape(c.id)+"'>"+escape(c.title)+"</option>").join("");
  if(state.activeCommunity)$("forumThreadCommunity").value=state.activeCommunity.id;
  if(!options.length){notify("Create a community before posting a topic.",true);return;}
 }
 dialog.showModal();
}
function cleanQuery(value){
 return String(value||"").trim().slice(0,70).replace(/[%_\\]/g,"");
}
function authPanel(){
 const el=$("authActions");
 el.replaceChildren();
 if(!state.user){
  const link=document.createElement("a");link.className="forum-button secondary";
  link.href="login.html?redirect=discussion.html";link.textContent="Log in";
  el.append(link);return;
 }
 const profile=document.createElement("a");
 profile.href="profile.html?id="+encodeURIComponent(state.user.id);
 profile.textContent=memberName();
 profile.className="forum-account-link";
 el.append(profile);
 const logout=document.createElement("button");logout.type="button";logout.textContent="Log out";
 logout.className="forum-signout";logout.addEventListener("click",async()=>{await signOut();location.href="discussion.html";});
 el.append(logout);
}
async function loadMemberships(){
 state.joined.clear();state.memberRoles.clear();
 if(!state.user)return;
 const {data,error}=await supabase.from("community_members")
   .select("community_id,role").eq("user_id",state.user.id)
   .order("joined_at",{ascending:false}).limit(200);
 if(error){console.warn("Community memberships unavailable",error.message);return;}
 for(const item of data||[]){state.joined.add(item.community_id);state.memberRoles.set(item.community_id,item.role);}
}
function renderCategories(){
 $("forumCategories").innerHTML=categories.map(name=>
  "<button type='button' data-category='"+escape(name)+"' aria-pressed='"+(state.selectedCategory===name?"true":"false")+"'>"+
   escape(name)+"</button>").join("");
 const select=$("forumCommunityCategory");
 select.innerHTML=categories.filter(x=>x!=="All").map(x=>
  "<option value='"+escape(x)+"'>"+escape(x)+"</option>").join("");
}
async function loadCommunities(reset=true){
 if(reset){state.communityPage=0;state.communities=[];}
 let query=supabase.from("discussion_topics").select(
  "id,slug,title,description,category,author_id,author_name,member_count,posting_policy,community_state,visibility,rules,icon_emoji,created_at")
  .eq("community_state","active")
  .order("member_count",{ascending:false}).order("created_at",{ascending:false});
 if(state.selectedCategory!=="All")query=query.eq("category",state.selectedCategory);
 if(state.communitySearch)query=query.ilike("title","%"+cleanQuery(state.communitySearch)+"%");
 const start=state.communityPage*30;
 const {data,error}=await query.range(start,start+30);
 if(error)throw error;
 state.hasMoreCommunities=(data||[]).length>30;
 const entries=(data||[]).slice(0,30);
 const seen=new Set(state.communities.map(x=>x.id));
 state.communities.push(...entries.filter(x=>!seen.has(x.id)));
 $("communityListCount").textContent=String(state.communities.length)+(state.hasMoreCommunities?"+":"");
 $("moreCommunities").hidden=!state.hasMoreCommunities;
 renderCommunityList();
 renderSuggestions();
}
function renderCommunityList(){
 const list=$("forumCommunityList");
 list.innerHTML=state.communities.length?state.communities.map(c=>
  "<button type='button' class='forum-community-item "+(state.activeCommunity?.id===c.id?"active":"")+
  "' data-open-community='"+escape(c.id)+"'>"+
  "<span class='forum-community-icon' aria-hidden='true'>"+escape(c.icon_emoji||"💬")+"</span>"+
  "<span><strong>"+escape(c.title)+"</strong><small>"+escape(c.category||"Technology")+
  " · "+Number(c.member_count||0).toLocaleString()+" members</small></span></button>").join(""):
  "<p class='forum-muted'>No communities found in this category.</p>";
}
function renderSuggestions(){
 $("forumSuggestions").innerHTML=state.communities.slice(0,4).map(c=>
  "<button type='button' data-open-community='"+escape(c.id)+"'><span aria-hidden='true'>"+
  escape(c.icon_emoji||"💬")+"</span><span><strong>"+escape(c.title)+"</strong><small>"+
  escape(c.category)+"</small></span></button>").join("")||
  "<p class='forum-muted'>No suggestions yet.</p>";
}
function setUrl(){
 const url=new URL(location.href);
 url.searchParams.delete("community");url.searchParams.delete("thread");
 if(state.activeThread)url.searchParams.set("thread",state.activeThread.id);
 else if(state.activeCommunity)url.searchParams.set("community",
  state.activeCommunity.visibility==="private"?state.activeCommunity.id:
  (state.activeCommunity.slug||state.activeCommunity.id));
 history.pushState({forum:true},"",url.pathname+url.search);
}
function renderNav(){
 document.querySelectorAll("[data-forum-nav]").forEach(btn=>{
  btn.classList.toggle("active",btn.dataset.forumNav===state.mode&&state.view!=="community");
 });
 renderCommunityList();
}
function enterFeed({mode="home",community=null,push=true,sort=null}={}){
 state.activeThread=null;state.activeCommunity=community;state.mode=mode;state.view=community?"community":"home";
 $("forumMembershipNotice").hidden=true;
 state.feed=[];state.feedCursor=null;state.feedHasMore=false;state.search="";
 $("forumThreadSearch").value="";
 if(sort)state.sort=sort;
 $("forumFeedView").hidden=false;$("forumThreadView").hidden=true;
 $("forumFeedTitle").textContent=community?community.title:
  mode==="joined"?"Your communities":mode==="saved"?"Saved topics":mode==="personal"?"My Tech · For You":"The community feed";
 $("forumFeedKicker").textContent=community?"COMMUNITY / "+String(community.category||"TECH").toUpperCase():
  mode==="joined"?"YOUR SUBSCRIPTIONS":mode==="saved"?"READ LATER":mode==="personal"?"PERSONALIZED":"DISCOVER";
 $("forumFeedSubtitle").textContent=community?community.description||"Explore community threads.":
  mode==="joined"?"New conversations in communities you've joined.":
  mode==="saved"?"The useful topics you saved for later.":mode==="personal"?"Ranked by your chosen interests, communities, freshness, and conversation quality.":"Ask questions, exchange ideas and share practical tech knowledge.";
 $("forumJoinButton").hidden=!community||!state.user;
 $("forumModerationButton").hidden=!community||!isCommunityStaff(community.id);
 if(community){
  $("forumJoinButton").textContent=state.joined.has(community.id)?"Joined ✓":community.visibility==="public"?"Join community":"Request to join";
  $("forumJoinButton").setAttribute("aria-pressed",String(state.joined.has(community.id)));
 }
 const details=$("forumCommunityDetails");
 details.hidden=!community;
 if(community){
  const role=state.memberRoles.get(community.id);
  details.innerHTML="<div class='forum-community-presentation'><span class='forum-community-big-icon' aria-hidden='true'>"+
  escape(community.icon_emoji||"💬")+"</span><div><span>"+escape(community.category)+
  " · "+Number(community.member_count||0)+" members</span><p>"+
  escape(community.description||"Join this community to discuss technology.")+"</p></div></div>"+
  (community.rules?"<details><summary>Community rules</summary><p>"+escape(community.rules)+"</p></details>":"")+
  (community.visibility!=="public"?"<p class='forum-privacy-label'>"+
   (community.visibility==="private"?"Private community":"Restricted: member-only discussions")+"</p>"+
   "<button type='button' class='forum-invite-copy' data-copy-invite='"+escape(community.id)+"'>Copy invite link</button>":"")+
  (role==="owner"?"<div class='forum-owner-controls'><label>Who may post? <select id='forumPostingPolicy'>"+
    ["everyone","members","staff"].map(policy=>"<option value='"+policy+"' "+(community.posting_policy===policy?"selected":"")+">"+
     (policy==="everyone"?"Everyone":policy==="members"?"Members":"Moderators")+"</option>").join("")+
  "</select></label><button id='forumSaveCommunityRules' type='button'>Save rule</button></div>":"");
 }
 document.querySelectorAll("[data-forum-sort]").forEach(btn=>btn.setAttribute("aria-pressed",String(btn.dataset.forumSort===state.sort)));
 renderNav();
 if(push)setUrl();
 void loadFeed(true);
}
function fieldForSort(){return state.sort==="top"?"score":state.sort==="new"||state.sort==="unanswered"?"created_at":"last_activity_at";}
async function loadFeed(reset=false){
 if(state.feedBusy&&!reset)return;
 const version=++state.feedVersion;
 state.feedBusy=true;
 if(reset){state.feed=[];state.feedCursor=null;state.feedHasMore=false;
  $("forumThreadFeed").innerHTML="<p class='forum-muted'>Loading topics…</p>";$("forumPinnedThreads").replaceChildren();}
 $("forumLoadMore").hidden=true;
 try{
  if(state.mode==="joined"&&!state.activeCommunity&&!state.joined.size){
   state.feed=[];renderFeed();return;
  }
  if(state.mode==="saved"&&!state.activeCommunity&&!state.user){
   state.feed=[];renderFeed();return;
  }
  if(state.mode==="personal"&&!state.activeCommunity){
   const {data,error}=await supabase.rpc("community_personal_feed",{
     p_limit:PAGE_SIZE,p_offset:reset?0:state.feed.length
   });
   if(error)throw error;
   if(version!==state.feedVersion)return;
   const page=data||[];
   state.feedHasMore=page.length===PAGE_SIZE&&state.feed.length<200;
   state.feed.push(...page.filter(row=>!state.feed.some(old=>old.id===row.id)));
   await loadPersonalThreadState(page.map(row=>row.id));
   if(version===state.feedVersion)renderFeed();
   return;
  }
  const selected=state.activeCommunity;
  if(reset&&selected){
   const {data:pinned}=await supabase.from("community_threads")
    .select("id,community_id,author_id,author_name,title,body,kind,status,is_pinned,is_locked,is_legacy_room,reply_count,score,media_url,media_type,created_at,last_activity_at")
    .eq("community_id",selected.id).eq("status","published").eq("is_pinned",true)
    .order("created_at",{ascending:false}).limit(4);
   if(version!==state.feedVersion)return;
   state.pinned=pinned||[];renderPinned();
  }
  let savedIds=[];
  if(state.mode==="saved"&&!selected){
   const {data,error}=await supabase.from("community_saved_threads")
     .select("thread_id").eq("user_id",state.user.id).order("created_at",{ascending:false}).limit(200);
   if(error)throw error;
   savedIds=(data||[]).map(v=>v.thread_id);
   if(!savedIds.length){state.feed=[];renderFeed();return;}
  }
  let query=supabase.from("community_threads")
    .select("id,community_id,author_id,author_name,title,body,kind,status,is_pinned,is_locked,is_legacy_room,reply_count,score,media_url,media_type,created_at,last_activity_at")
    .eq("status","published");
  if(selected)query=query.eq("community_id",selected.id).eq("is_pinned",false);
  else if(state.mode==="joined")query=query.in("community_id",[...state.joined].slice(0,200));
  else if(state.mode==="saved")query=query.in("id",savedIds);
  if(state.sort==="unanswered")query=query.eq("reply_count",0);
  const search=cleanQuery(state.search);
  if(search)query=query.textSearch("search_vector",search,{type:"websearch",config:"english"});
  const col=fieldForSort();
  query=query.order(col,{ascending:false}).order("id",{ascending:false});
  if(state.feedCursor){
   const cursor=state.feedCursor,v=cursor[col];
   // Indexed keyset pagination avoids ever-growing OFFSET scans.
   const literal=col==="score"?Number(v):String(v);
   query=query.or(col+".lt."+literal+",and("+col+".eq."+literal+",id.lt."+cursor.id+")");
  }
  const {data,error}=await query.limit(PAGE_SIZE+1);
  if(error)throw error;
  if(version!==state.feedVersion)return;
  const page=(data||[]).slice(0,PAGE_SIZE);
  state.feedHasMore=(data||[]).length>PAGE_SIZE;
  if(page.length)state.feedCursor=page.at(-1);
  const seen=new Set(state.feed.map(x=>x.id));
  state.feed.push(...page.filter(x=>!seen.has(x.id)));
  await loadPersonalThreadState(page.map(x=>x.id));
  if(version!==state.feedVersion)return;
  renderFeed();
 }catch(error){
  if(version===state.feedVersion){
   if(!state.feed.length)$("forumThreadFeed").innerHTML="<p class='forum-muted'>Could not load topics. Please retry.</p>";
   notify(error.message||"Could not load community topics.",true);
  }
 }finally{
  state.feedBusy=false;
  if(version===state.feedVersion)$("forumLoadMore").hidden=!state.feedHasMore;
 }
}
async function loadPersonalThreadState(ids){
 if(!state.user||!ids.length)return;
 const [votes,saved]=await Promise.all([
  supabase.from("community_thread_votes").select("thread_id,value").eq("user_id",state.user.id).in("thread_id",ids),
  supabase.from("community_saved_threads").select("thread_id").eq("user_id",state.user.id).in("thread_id",ids)
 ]);
 for(const item of votes.data||[])state.votes.set(item.thread_id,item.value);
 for(const item of saved.data||[])state.saved.add(item.thread_id);
}
function mediaHtml(url,type,kind="thread",itemId="",position=0){
 if(!url)return "";
 if(String(url).startsWith("forum-private-media/")){
  return "<div class='forum-attachment forum-private-attachment' data-private-kind='"+escape(kind)+
   "' data-private-id='"+escape(itemId)+"' data-private-position='"+Number(position)+
   "' data-media-type='"+escape(type||"image")+"'><span>🔒 Loading member-only media…</span></div>";
 }
 if(!isSafeUrl(url))return "";
 const safeUrl=escape(url);
 if(type==="video"||/\.(mp4|webm)(\?|$)/i.test(url))
  return "<div class='forum-attachment'><video src='"+safeUrl+"' preload='none' controls playsinline aria-label='Community video attachment'></video></div>";
 return "<div class='forum-attachment'><img src='"+safeUrl+"' loading='lazy' decoding='async' alt='Attached image'></div>";
}
async function hydratePrivateForumMedia(root){
 const nodes=[...root.querySelectorAll("[data-private-kind][data-private-id]")];
 if(!nodes.length)return;
 const {data}=await supabase.auth.getSession();
 const token=data?.session?.access_token;
 for(const node of nodes){
  if(!node.isConnected||!token)continue;
  const kind=node.dataset.privateKind,item_id=node.dataset.privateId;
  const position=Number(node.dataset.privatePosition||0);
  try{
   const response=await fetch("/.netlify/functions/forum-media-sign",{
    method:"POST",cache:"no-store",
    headers:{"Content-Type":"application/json","Authorization":"Bearer "+token},
    body:JSON.stringify({kind,item_id,position}),
    signal:AbortSignal.timeout(14000)
   });
   const payload=await response.json().catch(()=>({}));
   if(!response.ok||!payload.signedUrl||!isSafeUrl(payload.signedUrl))
    throw Error(payload.error||"Private attachment unavailable.");
   if(!node.isConnected)continue;
   const element=document.createElement(node.dataset.mediaType==="video"?"video":"img");
   element.src=payload.signedUrl;
   if(element.tagName==="VIDEO"){element.controls=true;element.preload="none";element.playsInline=true;}
   else{element.loading="lazy";element.decoding="async";element.alt="Private community attachment";}
   node.replaceChildren(element);
  }catch(error){
   node.textContent="🔒 "+(error.message||"Unable to load private media");
  }
 }
}
function showMarkdownPreview(field,preview){
 const input=$(field),output=$(preview);
 if(!input||!output)return;
 output.hidden=!output.hidden;
 if(!output.hidden)output.innerHTML=renderCommunityMarkdown(input.value);
}
function updateAllVisiblePreviews(){
 for(const [field,preview] of [["forumReplyText","forumReplyPreview"],["forumThreadBodyInput","forumThreadPreview"]]){
  if(!$(preview).hidden)$(preview).innerHTML=renderCommunityMarkdown($(field).value);
 }
}
async function loadInterests(){
 state.interests.clear();
 if(!state.user)return;
 const {data,error}=await supabase.from("community_user_interests").select("topic")
  .eq("user_id",state.user.id).limit(30);
 if(error){console.warn("Could not load interests",error.message);return;}
 for(const item of data||[])state.interests.add(item.topic);
}
function showInterestEditor(){
 if(!mustLogin())return;
 $("forumInterestOptions").innerHTML=categories.filter(x=>x!=="All").map(topic=>
  "<label><input type='checkbox' name='interest' value='"+escape(topic)+"' "+
  (state.interests.has(topic)?"checked":"")+">"+escape(topic)+"</label>").join("");
 $("forumInterestDialog").showModal();
}
async function submitInterests(event){
 event.preventDefault();
 if(!mustLogin())return;
 const selected=[...new FormData(event.currentTarget).getAll("interest")];
 const incoming=new Set(selected),removed=[...state.interests].filter(x=>!incoming.has(x));
 const added=selected.filter(x=>!state.interests.has(x));
 const results=await Promise.all([
  removed.length?supabase.from("community_user_interests").delete()
   .eq("user_id",state.user.id).in("topic",removed):Promise.resolve({error:null}),
  added.length?supabase.from("community_user_interests").insert(
   added.map(topic=>({user_id:state.user.id,topic}))):Promise.resolve({error:null})
 ]);
 const failure=results.find(r=>r.error);
 if(failure){notify(failure.error.message,true);await loadInterests();return;}
 state.interests=incoming;$("forumInterestDialog").close();
 notify("Your My Tech interests were updated.");
 if(state.mode==="personal")await loadFeed(true);
}
async function hideRecommendation(threadId){
 if(!mustLogin())return;
 const {error}=await supabase.from("community_feed_feedback").upsert({
   user_id:state.user.id,thread_id:threadId,feedback:"not_interested"
 },{onConflict:"user_id,thread_id"});
 if(error){notify(error.message,true);return;}
 state.feed=state.feed.filter(t=>t.id!==threadId);
 renderFeed();notify("This topic will no longer be recommended.");
}
async function renderCommunityPoll(threadId){
 const host=$("forumPollContainer");host.hidden=true;host.replaceChildren();
 const {data,error}=await supabase.rpc("community_poll_summary",{p_thread:threadId});
 if(state.activeThread?.id!==threadId||error||!data?.id)return;
 const closed=Boolean(data.closed_at)||(data.ends_at&&Date.parse(data.ends_at)<=Date.now());
 const total=Math.max(0,Number(data.total_votes||0));
 const canVote=Boolean(state.user)&&!closed;
 host.hidden=false;
 host.innerHTML="<div class='forum-poll-header'><strong>Poll · "+escape(data.question)+"</strong>"+
  "<small>"+(closed?"Voting closed":data.ends_at?"Ends "+escape(new Date(data.ends_at).toLocaleString()):"No closing time")+"</small></div>"+
  "<div class='forum-poll-options'>"+(data.options||[]).map(opt=>{
    const n=Number(opt.number),count=Number(opt.votes||0),pct=total?Math.round(count*100/total):0;
    const chosen=Number(data.my_vote)===n;
    return "<button type='button' data-forum-poll-vote='"+n+"' "+(!canVote?"disabled":"")+
     " aria-pressed='"+chosen+"' class='forum-poll-option "+(chosen?"selected":"")+"'>"+
     "<span>"+escape(opt.label)+"</span>"+
     (data.results_visible?"<strong>"+pct+"% · "+count+"</strong>":"<strong>"+(canVote?"Vote":"Sign in")+"</strong>")+
     (data.results_visible?"<i style='width:"+pct+"%' aria-hidden='true'></i>":"")+"</button>";
  }).join("")+"</div><p>"+total+" votes · One selection per member; you can change your vote until closing.</p>";
}
async function castCommunityPollVote(option){
 if(!mustLogin()||!state.activeThread)return;
 const poll=await supabase.rpc("community_poll_summary",{p_thread:state.activeThread.id});
 if(poll.error||!poll.data?.id)return;
 const {error}=await supabase.rpc("community_vote_poll",{
  p_poll:poll.data.id,p_option:option
 });
 if(error){notify(error.message||"Unable to cast vote.",true);return;}
 await renderCommunityPoll(state.activeThread.id);
 notify("Vote recorded.");
}
async function attachPollToThread(thread,values){
 const question=String(values.get("poll_question")||"").trim();
 if(!question)return null;
 const options=values.getAll("poll_option").map(x=>String(x||"").trim()).filter(Boolean);
 if(options.length<2||options.length>6)throw Error("Polls need 2–6 nonempty options.");
 if(thread.status!=="published")return "Poll setup will be available after moderation approval.";
 const hours=Number(values.get("poll_duration")||0);
 const endsAt=hours?new Date(Date.now()+hours*3600000).toISOString():null;
 const {error}=await supabase.rpc("community_create_poll",{
  p_thread:thread.id,p_question:question,p_options:options,p_ends_at:endsAt
 });
 if(error)return "Your topic was posted, but the poll could not be created: "+error.message;
 return null;
}
async function uploadForumGallery(files,communityId){
 if(!files.length)return [];
 if(files.length>6)throw Error("You can attach at most six photos.");
 if(files.length>1&&files.some(file=>!file.type.startsWith("image/")))
  throw Error("Use up to six photos or one video, not a mixture.");
 const uploaded=[];
 try{
  for(const file of files)uploaded.push(await uploadForumFile(file,"community-threads",communityId));
  return uploaded;
 }catch(error){
  await Promise.all(uploaded.map(discardRejectedUpload));
  throw error;
 }
}
function mediaFile(input){
 const file=input?.files?.[0];return file?.size?file:null;
}
async function uploadForumFile(file,folder,communityId){
 if(!file)return {url:null,type:null};
 if(file.size>12*1024*1024||file.size<1)throw Error("Attachment must be under 12 MB.");
 if(!["image/jpeg","image/png","image/webp","image/gif","video/mp4","video/webm"].includes(file.type))
  throw Error("Use JPEG, PNG, WebP, GIF, MP4 or WebM.");
 const board=findCommunity(communityId)||state.activeCommunity;
 if(!board||board.id!==communityId)throw Error("Select a community before attaching media.");
 const isPrivate=board.visibility!=="public";
 const extension=String(file.name||"").split(".").pop().toLowerCase();
 if(!["jpg","jpeg","png","gif","webp","mp4","webm"].includes(extension))
  throw Error("This attachment file extension is unsupported.");
 if(isPrivate){
  const path=state.user.id+"/"+(folder==="community-replies"?"replies":"threads")+
    "/"+crypto.randomUUID()+"."+extension;
  const {error}=await supabase.storage.from("forum-private-media").upload(path,file,{
   upsert:false,contentType:file.type,cacheControl:"180"
  });
  if(error)throw Error(error.message||"Private media upload failed.");
  return {url:"forum-private-media/"+path,type:file.type.startsWith("video")?"video":"image",
   path,bucket:"forum-private-media"};
 }
 const {uploadMedia}=await import("./media.js");
 const url=await uploadMedia(file,folder+"/"+state.user.id);
 if(!url)throw Error("Unable to upload attachment.");
 const expected="/storage/v1/object/public/media/"+folder+"/"+state.user.id+"/";
 let path=null;
 try{
  const parsed=new URL(url);
  if(parsed.hostname.endsWith(".supabase.co")&&parsed.pathname.startsWith(expected)&&
   !parsed.pathname.includes("..")&&!parsed.search){
    path=decodeURIComponent(parsed.pathname.slice("/storage/v1/object/public/media/".length));
  }
 }catch{ /* Upload succeeded; backend will still reference the returned URL. */ }
 return {url,type:file.type.startsWith("video")?"video":"image",path,bucket:"media"};
}
async function discardRejectedUpload(attachment){
 if(!attachment?.path||!state.user)return;
 const privateMedia=attachment.bucket==="forum-private-media";
 const allowed=privateMedia?
  attachment.path.startsWith(state.user.id+"/threads/")||attachment.path.startsWith(state.user.id+"/replies/"):
  ["community-threads/","community-replies/"].some(prefix=>
   attachment.path.startsWith(prefix+state.user.id+"/"));
 if(!allowed)return;
 const {error}=await supabase.storage.from(privateMedia?"forum-private-media":"media").remove([attachment.path]);
 if(error)console.warn("Could not reclaim failed community upload:",error.message);
}
function threadCard(thread,{pinned=false}={}){
 const community=findCommunity(thread.community_id);
 const label=thread.kind==="question"?"Question":thread.kind==="guide"?"Guide":thread.kind==="news"?"News":
  thread.kind==="showcase"?"Project":thread.kind==="announcement"?"Official":"Discussion";
 const intro=String(thread.body||"").replace(/\s+/g," ").slice(0,220);
 return "<article class='forum-thread-card' data-thread-card='"+escape(thread.id)+"'>"+
  "<div class='forum-vote-rail'>"+
  "<button type='button' data-vote='1' data-id='"+escape(thread.id)+"' class='"+(state.votes.get(thread.id)===1?"selected":"")+"' aria-label='Upvote topic' aria-pressed='"+(state.votes.get(thread.id)===1)+"'>▲</button>"+
  "<strong data-score='"+escape(thread.id)+"'>"+Number(thread.score||0)+"</strong>"+
  "<button type='button' data-vote='-1' data-id='"+escape(thread.id)+"' class='"+(state.votes.get(thread.id)===-1?"selected":"")+"' aria-label='Downvote topic' aria-pressed='"+(state.votes.get(thread.id)===-1)+"'>▼</button></div>"+
  "<div class='forum-thread-main'>"+
  "<div class='forum-thread-meta'><span class='forum-topic-kind'>"+escape(label)+"</span>"+
  (pinned||thread.is_pinned?"<span class='forum-topic-pinned'>📌 Pinned</span>":"")+
  (thread.is_locked?"<span>🔒 Locked</span>":"")+
  (community?"<button type='button' data-open-community='"+escape(community.id)+"'>"+
   escape(community.title)+"</button>":"")+
  "<span>· "+escape(preferredDate(thread.created_at))+"</span></div>"+
  "<button class='forum-thread-title' data-open-thread='"+escape(thread.id)+"' type='button'>"+escape(thread.title)+"</button>"+
  (intro?"<p>"+escape(intro)+"</p>":"")+
  (thread.ranking_reason&&state.mode==="personal"?"<small class='forum-ranking-reason'>"+
   escape(thread.ranking_reason)+"</small>":"")+
  (thread.media_url?"<span class='forum-topic-media-indicator'>◈ Media attached</span>":"")+
  "<div class='forum-thread-footer'><span>By "+escape(thread.author_name||"Member")+"</span>"+
  "<button type='button' data-open-thread='"+escape(thread.id)+"'>"+
   Number(thread.reply_count||0)+" replies</button>"+
  "<button type='button' data-save-thread='"+escape(thread.id)+"' aria-pressed='"+state.saved.has(thread.id)+"'>"+
   (state.saved.has(thread.id)?"★ Saved":"☆ Save")+"</button>"+
  "<button type='button' data-copy-thread='"+escape(thread.id)+"'>↗ Share</button>"+
  (state.mode==="personal"?"<button type='button' data-not-interested='"+escape(thread.id)+"'>Not interested</button>":"")+
  "<button type='button' data-report-thread='"+escape(thread.id)+"'>Report</button></div></div></article>";
}
function renderPinned(){
 $("forumPinnedThreads").innerHTML=state.pinned.length?
  "<div class='forum-pinned-heading'>Pinned by moderators</div>"+
  state.pinned.map(thread=>threadCard(thread,{pinned:true})).join(""):"";
}
function renderFeed(){
 const host=$("forumThreadFeed");
 if(!state.feed.length){
  const text=state.mode==="joined"?"You haven't joined any communities yet.":
   state.mode==="saved"?"No saved topics yet.":
   state.activeCommunity?"No threads here yet. Start a useful conversation.":
   "No topics found yet. Be the first to post.";
  host.innerHTML="<div class='forum-empty'><strong>Nothing here yet</strong><p>"+escape(text)+
  "</p><button type='button' data-create-topic>Create a topic</button></div>";
 }else host.innerHTML=state.feed.map(thread=>threadCard(thread)).join("");
 $("forumLoadMore").hidden=!state.feedHasMore;
}
async function openCommunity(id,{push=true}={}){
 let board=findCommunity(id);
 if(!board){
  const {data,error}=await supabase.from("discussion_topics")
    .select("id,slug,title,description,category,author_id,author_name,member_count,posting_policy,community_state,visibility,rules,icon_emoji,created_at")
    .eq("id",id).maybeSingle();
  if(error||!data){notify("Community not available.",true);return;}
  board=data;state.communities.push(board);
 }
 enterFeed({community:board,mode:"community",push});
 window.scrollTo({top:0,behavior:"smooth"});
}
async function openCommunitySlug(slug,{push=false}={}){
 const existing=state.communities.find(c=>c.slug===slug||c.id===slug);
 if(existing){await openCommunity(existing.id,{push});return;}
 const field=validId(slug)?"id":"slug";
 const {data,error}=await supabase.from("discussion_topics")
  .select("id,slug,title,description,category,author_id,author_name,member_count,posting_policy,community_state,visibility,rules,icon_emoji,created_at")
  .eq(field,slug).maybeSingle();
 if(error||!data){
   if(validId(slug)){
    notify("This may be an unlisted private community. Only approved members can see its details.",true);
    const host=$("forumMembershipNotice");host.hidden=false;
    host.innerHTML="<div><strong>Private community</strong><p>Request access with this invitation link. Moderators must approve new members.</p>"+
     "<button type='button' data-private-invite='"+escape(slug)+"'>Request membership</button></div>";
   }else notify("Community not found.",true);
   return;
 }
 $("forumMembershipNotice").hidden=true;
 state.communities.push(data);
 await openCommunity(data.id,{push});
}
async function toggleJoin(){
 if(!mustLogin()||!state.activeCommunity)return;
 const c=state.activeCommunity,joined=state.joined.has(c.id);
 const button=$("forumJoinButton");setButtonBusy(button,true);
 try{
  if(joined){
   const role=state.memberRoles.get(c.id);
   if(role==="owner"){notify("The community owner can't leave their own community.",true);return;}
   const {error}=await supabase.from("community_members").delete().eq("community_id",c.id).eq("user_id",state.user.id);
   if(error)throw error;state.joined.delete(c.id);state.memberRoles.delete(c.id);c.member_count=Math.max(0,Number(c.member_count)-1);
  }else if(c.visibility!=="public"){
   const {error}=await supabase.rpc("community_request_join",{
     p_community:c.id,p_note:""
   });
   if(error)throw error;
   button.textContent="Request pending";button.disabled=true;
   notify("Request sent. Community moderators will review your membership.");
   return;
  }else{
   const {error}=await supabase.from("community_members").insert({community_id:c.id,user_id:state.user.id,role:"member"});
   if(error)throw error;state.joined.add(c.id);state.memberRoles.set(c.id,"member");c.member_count=Number(c.member_count||0)+1;
  }
  $("forumJoinButton").textContent=joined?"Join community":"Joined ✓";
  $("forumJoinButton").setAttribute("aria-pressed",String(!joined));renderCommunityList();
  notify(joined?"You left this community.":"You've joined this community.");
 }catch(e){notify(e.message||"Unable to update membership.",true);}
 finally{setButtonBusy(button,false);}
}
async function voteThread(id,value){
 if(!mustLogin()||!validId(id)||state.voteBusy.has(id))return;
 state.voteBusy.add(id);
 const old=state.votes.get(id)||0;
 try{
  if(old===value){
   const {error}=await supabase.from("community_thread_votes").delete().eq("thread_id",id).eq("user_id",state.user.id);
   if(error)throw error;state.votes.delete(id);
  }else if(old){
   const {error}=await supabase.from("community_thread_votes").update({value})
    .eq("thread_id",id).eq("user_id",state.user.id);
   if(error)throw error;state.votes.set(id,value);
  }else{
   const {error}=await supabase.from("community_thread_votes").insert({
    thread_id:id,user_id:state.user.id,value
   });
   if(error)throw error;state.votes.set(id,value);
  }
  const scoreDiff=(state.votes.get(id)||0)-old;
  const thread=[...state.feed,...state.pinned,state.activeThread].find(t=>t?.id===id);
  if(thread)thread.score=Number(thread.score||0)+scoreDiff;
  document.querySelectorAll("[data-score='"+id+"']").forEach(node=>{node.textContent=String(Number(node.textContent||0)+scoreDiff);});
  document.querySelectorAll("[data-vote][data-id='"+id+"']").forEach(button=>{
   button.classList.toggle("selected",Number(button.dataset.vote)===state.votes.get(id));
   button.setAttribute("aria-pressed",String(Number(button.dataset.vote)===state.votes.get(id)));
  });
 }catch(e){notify(e.message||"Couldn't register vote.",true);}
 finally{state.voteBusy.delete(id);}
}
async function toggleSave(id){
 if(!mustLogin())return;
 const saved=state.saved.has(id);
 try{
  const operation=saved?supabase.from("community_saved_threads").delete()
     .eq("thread_id",id).eq("user_id",state.user.id):
     supabase.from("community_saved_threads").insert({thread_id:id,user_id:state.user.id});
  const {error}=await operation;if(error)throw error;
  if(saved)state.saved.delete(id);else state.saved.add(id);
  document.querySelectorAll("[data-save-thread='"+id+"']").forEach(button=>{
    button.textContent=saved?"☆ Save":"★ Saved";
    button.setAttribute("aria-pressed",String(!saved));
  });
  notify(saved?"Removed from saved topics.":"Saved for later.");
 }catch(e){notify(e.message||"Couldn't update your saves.",true);}
}
async function shareThread(id){
 const url=new URL("discussion.html",location.href);
 url.searchParams.set("thread",id);
 try{
  if(navigator.share)await navigator.share({title:"Timzee Tech Hub discussion",url:url.href});
  else{await navigator.clipboard.writeText(url.href);notify("Topic link copied.");}
 }catch(e){if(e.name!=="AbortError")notify("Unable to share this topic.",true);}
}
async function openThread(id,{push=true}={}){
 if(!validId(id))return;
 const {data,error}=await supabase.from("community_threads")
  .select("id,community_id,author_id,author_name,title,body,kind,status,is_locked,is_pinned,is_legacy_room,created_at,reply_count,score,media_url,media_type")
  .eq("id",id).maybeSingle();
 if(error||!data||!(data.status==="published"||
   (state.user&&data.author_id===state.user.id)||isCommunityStaff(data.community_id))){
   notify("This topic is unavailable.",true);return;
 }
 const board=findCommunity(data.community_id);
 state.activeThread=data;state.view="thread";
 if(!state.activeCommunity||state.activeCommunity.id!==data.community_id){
  if(board)state.activeCommunity=board;
  else{
   const q=await supabase.from("discussion_topics").select("id,slug,title,description,category,author_id,author_name,member_count,posting_policy,community_state,visibility,rules,icon_emoji").eq("id",data.community_id).maybeSingle();
   if(q.data){state.activeCommunity=q.data;state.communities.push(q.data);}
  }
 }
 $("forumFeedView").hidden=true;$("forumThreadView").hidden=false;
 const boardName=state.activeCommunity?.title||"Community";
 const staff=isCommunityStaff(data.community_id);
 $("forumThreadHeader").innerHTML="<p class='forum-eyebrow'>"+
  "<button type='button' data-open-community='"+escape(data.community_id)+"'>"+
  escape(boardName)+"</button> / "+escape(data.kind)+"</p><h1>"+escape(data.title)+
  "</h1><p class='forum-thread-detail-meta'>By "+escape(data.author_name||"Member")+
  " · "+escape(preferredDate(data.created_at))+(data.is_locked?" · Locked":"")+"</p>";
 $("forumThreadBody").innerHTML=renderCommunityMarkdown(data.body||"");
 if(data.media_url)$("forumThreadBody").insertAdjacentHTML("beforeend",mediaHtml(data.media_url,data.media_type,"thread",data.id));
 const attachments=await supabase.from("community_thread_media")
  .select("media_url,media_type,position").eq("thread_id",data.id)
  .order("position",{ascending:true}).limit(6);
 if(state.activeThread?.id!==data.id)return;
 const extras=attachments.data||[];
 if(extras.length){
  const gallery=document.createElement("div");gallery.className="forum-gallery";
  gallery.innerHTML=extras.map(media=>mediaHtml(media.media_url,media.media_type,"gallery",data.id,media.position)).join("");
  $("forumThreadBody").append(gallery);
 }
 void hydratePrivateForumMedia($("forumThreadBody"));
 void renderCommunityPoll(data.id);
 $("forumThreadActions").innerHTML=
  "<button type='button' data-vote='1' data-id='"+id+"'>▲</button>"+
  "<strong data-score='"+id+"'>"+Number(data.score||0)+"</strong>"+
  "<button type='button' data-vote='-1' data-id='"+id+"'>▼</button>"+
  "<button type='button' data-save-thread='"+id+"'>☆ Save</button>"+
  "<button type='button' data-copy-thread='"+id+"'>↗ Share</button>"+
  "<button type='button' data-report-thread='"+id+"'>Report</button>"+
  (staff?"<select id='forumModerateAction' aria-label='Moderate this topic'><option value=''>Moderate…</option>"+
    ["pin","unpin","lock","unlock","remove"].map(v=>"<option value='"+v+"'>"+v+"</option>").join("")+
   "</select>":"");
 $("forumReplyForm").hidden=Boolean(data.is_locked||data.status!=="published");
 if(data.status==="pending")notify("This topic is awaiting a moderator's review.");
 if(data.status==="removed")notify("This topic was removed from the public community.");
 state.replyVersion++;
 state.loadingReplies=false;
 state.replies=[];state.replyCursor=null;state.repliesHasMore=false;state.replyTo=null;
 $("forumReplyTarget").hidden=true;
 await loadPersonalThreadState([data.id]);
 const vote=state.votes.get(data.id)||0;
 document.querySelectorAll("#forumThreadActions [data-vote]").forEach(b=>{
  b.classList.toggle("selected",Number(b.dataset.vote)===vote);
  b.setAttribute("aria-pressed",String(Number(b.dataset.vote)===vote));
 });
 const save=$("forumThreadActions").querySelector("[data-save-thread]");
 if(save){save.textContent=state.saved.has(data.id)?"★ Saved":"☆ Save";save.setAttribute("aria-pressed",String(state.saved.has(data.id)));}
 if(push)setUrl();
 await loadReplies(true);
 window.scrollTo({top:0,behavior:"smooth"});
}
async function loadReplies(reset=false){
 if(!state.activeThread||(state.loadingReplies&&!reset))return;
 const version=++state.replyVersion;
 state.loadingReplies=true;
 const threadId=state.activeThread.id;
 if(reset){state.replies=[];state.replyCursor=null;$("forumReplies").innerHTML="<p class='forum-muted'>Loading replies…</p>";}
 $("forumMoreReplies").hidden=true;
 try{
  let query=supabase.from("discussion_messages")
    .select("id,author_id,author_name,body,reply_to,created_at,media_url,media_type,pinned")
    .eq("thread_id",threadId)
    .order("created_at",{ascending:true}).order("id",{ascending:true});
  if(state.replyCursor){
   const t=state.replyCursor;
   query=query.or("created_at.gt."+t.created_at+",and(created_at.eq."+t.created_at+",id.gt."+t.id+")");
  }
  const {data,error}=await query.limit(31);
  if(error)throw error;
  if(version!==state.replyVersion||state.activeThread?.id!==threadId)return;
  const page=(data||[]).slice(0,30);
  state.repliesHasMore=(data||[]).length>30;
  if(page.length)state.replyCursor=page.at(-1);
  const seen=new Set(state.replies.map(r=>r.id));
  state.replies.push(...page.filter(r=>!seen.has(r.id)));
  const ids=page.map(item=>item.id);
  if(ids.length){
   const {data:voteTotals,error:voteError}=await supabase.rpc("forum_reply_vote_summary",{
     p_messages:ids
   });
   if(!voteError)for(const vote of voteTotals||[])state.replyVotes.set(vote.message_id,{
      score:Number(vote.score||0),mine:Number(vote.my_vote||0)
   });
  }
  renderReplies();
 }catch(e){
   if(version===state.replyVersion)notify(e.message||"Couldn't load replies.",true);
 }
 finally{
  if(version===state.replyVersion){
   state.loadingReplies=false;
   $("forumMoreReplies").hidden=!state.repliesHasMore;
  }
 }
}
function renderReplies(){
 const replies=state.replies,byId=new Map(replies.map(x=>[x.id,x]));
 $("forumThreadTitle").textContent="Replies ("+Number(state.activeThread?.reply_count||replies.length)+")";
 $("forumReplies").innerHTML=replies.map((r,i)=>{
  const parent=byId.get(r.reply_to);
  const header="<div class='forum-reply-meta'><strong>"+escape(r.author_name||"Member")+
    "</strong><span>· "+escape(preferredDate(r.created_at))+"</span>"+
    (r.pinned?"<span class='forum-topic-pinned'>Pinned</span>":"")+"</div>";
  const quote=r.reply_to?"<button type='button' data-jump-reply='"+escape(r.reply_to)+
    "' class='forum-reply-reference'>↳ Reply to "+escape(parent?.author_name||"an earlier message")+"</button>":"";
  return "<article class='forum-reply' id='reply-"+escape(r.id)+"'>"+
   "<span class='forum-reply-number'>#"+(i+1)+"</span><div class='forum-reply-main'>"+
   header+quote+"<div class='forum-reply-body forum-markdown'>"+renderCommunityMarkdown(r.body||"")+"</div>"+
   mediaHtml(r.media_url,r.media_type,"reply",r.id)+
   "<div class='forum-reply-actions'>"+
   "<button type='button' data-vote-reply='"+escape(r.id)+"' data-reply-vote-value='1' "+
      "aria-pressed='"+(state.replyVotes.get(r.id)?.mine===1)+"'>▲</button>"+
   "<span class='forum-reply-score'>"+Number(state.replyVotes.get(r.id)?.score||0)+"</span>"+
   "<button type='button' data-vote-reply='"+escape(r.id)+"' data-reply-vote-value='-1' "+
      "aria-pressed='"+(state.replyVotes.get(r.id)?.mine===-1)+"'>▼</button>"+
   "<button type='button' data-reply-to='"+escape(r.id)+"'>Reply</button>"+
   "<button type='button' data-copy-reply='"+escape(r.id)+"'>Copy link</button>"+
   "<button type='button' data-report-reply='"+escape(r.id)+"'>Report</button>"+
   (isCommunityStaff(state.activeThread?.community_id)&&r.author_id&&r.author_id!==state.user?.id
    ?"<button type='button' data-ban-author='"+escape(r.author_id)+"'>Ban member</button>":"")+
   "</div></div></article>";
 }).join("")||"<div class='forum-empty'><strong>No replies yet</strong><p>Start a helpful discussion.</p></div>";
 $("forumMoreReplies").hidden=!state.repliesHasMore;
 void hydratePrivateForumMedia($("forumReplies"));
}
function startReply(id){
 if(!mustLogin())return;
 const target=state.replies.find(r=>r.id===id);
 if(!target)return;
 state.replyTo=id;
 $("forumReplyTarget").hidden=false;
 $("forumReplyTarget").innerHTML="<span>Replying to "+escape(target.author_name||"Member")+"</span>"+
  "<button type='button' data-cancel-reply aria-label='Cancel reply'>×</button>";
 $("forumReplyText").focus();
 $("forumReplyForm").scrollIntoView({behavior:"smooth",block:"center"});
}
async function createCommunity(event){
 event.preventDefault();
 if(!mustLogin())return;
 const form=event.currentTarget,button=form.querySelector("[type=submit]");
 const values=new FormData(form);
 const title=String(values.get("title")||"").trim();
 const description=String(values.get("description")||"").trim();
 if(title.length<3||description.length<20){$("forumCommunityFormError").textContent="Add a meaningful name and description.";return;}
 setButtonBusy(button,true);$("forumCommunityFormError").textContent="";
 try{
  const id=crypto.randomUUID();
  const {data,error}=await supabase.from("discussion_topics").insert({
    id,title,description,category:String(values.get("category")||"Technology"),
    posting_policy:String(values.get("posting_policy")||"everyone"),
    visibility:String(values.get("visibility")||"public"),
    author_id:state.user.id,author_name:memberName(),
    created_at:new Date().toISOString(),updated_at:new Date().toISOString()
  }).select("id,slug,title,description,category,author_id,author_name,member_count,posting_policy,community_state,visibility,rules,icon_emoji,created_at").single();
  if(error)throw error;
  state.communities.unshift({...data,visibility:String(values.get("visibility")||"public")});state.joined.add(id);state.memberRoles.set(id,"owner");
  $("forumCommunityDialog").close();form.reset();
  renderCommunityList();await openCommunity(id);
  notify("Your community is ready! Start its first topic.");
 }catch(e){$("forumCommunityFormError").textContent=e.message||"Unable to create community.";}
 finally{setButtonBusy(button,false);}
}
async function createThread(event){
 event.preventDefault();
 if(!mustLogin())return;
 const form=event.currentTarget,button=form.querySelector("[type=submit]");
 const values=new FormData(form);
 const communityId=String(values.get("community_id")||"");
 if(!validId(communityId)){$("forumThreadFormError").textContent="Choose a community.";return;}
 setButtonBusy(button,true);$("forumThreadFormError").textContent="";
 let uploaded=[],created=null;
 try{
  const files=[...(form.querySelector("[name=media]")?.files||[])];
  uploaded=await uploadForumGallery(files,communityId);
  const first=uploaded[0];
  const {data,error}=await supabase.from("community_threads").insert({
    community_id:communityId,author_id:state.user.id,author_name:memberName(),
    media_url:first?.url||null,media_type:first?.type||null,
    title:String(values.get("title")||"").trim(),
    body:String(values.get("body")||"").trim(),
    kind:String(values.get("kind")||"discussion")
  }).select("id,status").single();
  if(error)throw error;
  created=data;
  if(uploaded.length>1){
   const {error:galleryError}=await supabase.from("community_thread_media").insert(
    uploaded.slice(1).map((item,index)=>({
      thread_id:data.id,position:index+1,media_url:item.url,
      media_type:item.type,added_by:state.user.id
    }))
   );
   if(galleryError)notify("The topic posted but some gallery attachments could not be saved.",true);
  }
  const pollMessage=await attachPollToThread(created,values);
  $("forumThreadDialog").close();form.reset();
  $("forumPollOptions").innerHTML="<input name='poll_option' maxlength='120' placeholder='Option 1'><input name='poll_option' maxlength='120' placeholder='Option 2'>";
  if(data.status==="published")await openThread(data.id);
  else enterFeed({mode:"personal"});
  notify(data.status==="pending"
    ?"Your topic is awaiting moderator approval. Other members cannot see it yet."
    :pollMessage||"Topic published.");
 }catch(e){
  if(!created)await Promise.all(uploaded.map(discardRejectedUpload));
  $("forumThreadFormError").textContent=e.message||"Unable to publish.";
 }finally{setButtonBusy(button,false);}
}

async function voteCommunityReply(id,value){
 if(!mustLogin()||state.replyVoteBusy.has(id))return;
 state.replyVoteBusy.add(id);
 try{
  const {error}=await supabase.rpc("forum_cast_reply_vote",{
   p_message:id,p_value:value
  });
  if(error)throw error;
  const totals=await supabase.rpc("forum_reply_vote_summary",{p_messages:[id]});
  if(totals.error)throw totals.error;
  const result=(totals.data||[])[0];
  if(result)state.replyVotes.set(id,{score:Number(result.score||0),mine:Number(result.my_vote||0)});
  renderReplies();
 }catch(error){notify(error.message||"Unable to vote on this reply.",true);}
 finally{state.replyVoteBusy.delete(id);}
}
async function submitReply(event){
 event.preventDefault();
 if(!mustLogin()||!state.activeThread)return;
 const body=$("forumReplyText").value.trim();
 const selectedMedia=mediaFile($("forumReplyMedia"));
 if(!body&&!selectedMedia){notify("Write a reply or attach media.",true);return;}
 const button=event.currentTarget.querySelector("[type=submit]");setButtonBusy(button,true);
 let attachment=null;
 try{
  attachment=await uploadForumFile(selectedMedia,"community-replies",state.activeThread.community_id);
  const {error}=await supabase.from("discussion_messages").insert({
    id:crypto.randomUUID(),thread_id:state.activeThread.id,topic_id:state.activeThread.community_id,
    author_id:state.user.id,author_name:memberName(),body,reply_to:state.replyTo,
    media_url:attachment.url,media_type:attachment.type
  });
  if(error)throw error;
  attachment=null;
  $("forumReplyText").value="";$("forumReplyMedia").value="";state.replyTo=null;$("forumReplyTarget").hidden=true;
  state.activeThread.reply_count=Number(state.activeThread.reply_count||0)+1;
  state.replies=[];state.replyCursor=null;await loadReplies(true);
  notify("Reply posted.");
 }catch(e){await discardRejectedUpload(attachment);notify(e.message||"Unable to post a reply.",true);}
 finally{setButtonBusy(button,false);}
}
async function moderateThread(action){
 const t=state.activeThread;if(!t||!action)return;
 try{
  const {data,error}=await supabase.rpc("community_manage_thread",{p_thread:t.id,p_action:action});
  if(error)throw error;
  if(data?.status==="removed"){notify("Topic removed from the public feed.");enterFeed({community:state.activeCommunity});return;}
  t.is_locked=data.is_locked;t.is_pinned=data.is_pinned;
  $("forumReplyForm").hidden=t.is_locked;
  notify("Moderation action applied: "+action+".");
 }catch(e){notify(e.message||"Moderation action unavailable.",true);}
}
function openForumReport(type,id){
 if(!mustLogin())return;
 const thread=type==="thread"?[state.activeThread,...state.feed,...state.pinned]
   .find(x=>x?.id===id):state.activeThread;
 if(!thread?.community_id){notify("Unable to identify this community.",true);return;}
 state.reportTarget={type,id,communityId:thread.community_id};
 $("forumReportError").textContent="";
 $("forumReportDialog").showModal();
}
async function submitForumReport(event){
 event.preventDefault();
 const payload=state.reportTarget;
 if(!payload||!state.user)return;
 const form=event.currentTarget,button=form.querySelector('[type="submit"]');
 setButtonBusy(button,true);
 try{
  const reason=String(new FormData(form).get("reason")||"").trim();
  const {error}=await supabase.from("community_reports").insert({
   community_id:payload.communityId,reporter_id:state.user.id,
   target_type:payload.type,target_id:payload.id,reason
  });
  if(error)throw error;
  $("forumReportDialog").close();form.reset();state.reportTarget=null;
  notify("Thanks. Your report was sent privately to the community moderators.");
 }catch(error){$("forumReportError").textContent=error.message||"Unable to send report.";}
 finally{setButtonBusy(button,false);}
}
async function openModerationWorkspace(){
 const board=state.activeCommunity;
 if(!board||!isCommunityStaff(board.id))return;
 $("forumModerationDialog").showModal();
 $("forumAutomaticQueue").textContent="Loading automatic review queue…";
 $("forumJoinQueue").textContent="Loading membership requests…";
 $("forumReportsQueue").textContent="Loading reports…";
 $("forumModeratorMembers").textContent="Loading community members…";
 await Promise.all([loadModerationReports(board.id),loadModeratorMembers(board.id),loadAutomodQueue(board.id),loadJoinQueue(board.id)]);
}
async function loadAutomodQueue(boardId){
 const host=$("forumAutomaticQueue");
 const {data,error}=await supabase.rpc("community_pending_content",{
  p_community:boardId,p_limit:30
 });
 if(error){host.textContent=error.message;return;}
 host.innerHTML=(data||[]).map(item=>
  "<article class='forum-mod-item'><strong>"+escape(item.type)+" · "+
   escape(item.reason||"Needs review")+"</strong><p>"+escape(item.text)+"</p>"+
   "<div><button type='button' data-auto-review='"+escape(item.id)+"' data-auto-type='"+escape(item.type)+"' data-auto-action='approve'>Approve</button>"+
   "<button type='button' data-auto-review='"+escape(item.id)+"' data-auto-type='"+escape(item.type)+"' data-auto-action='remove'>Remove</button></div></article>"
 ).join("")||"<p class='forum-muted'>No suspicious content needs review.</p>";
}
async function loadJoinQueue(boardId){
 const host=$("forumJoinQueue");
 const {data,error}=await supabase.from("community_join_requests")
  .select("user_id,note,created_at").eq("community_id",boardId)
  .eq("status","pending").order("created_at",{ascending:true}).limit(30);
 if(error){host.textContent=error.message;return;}
 host.innerHTML=(data||[]).map(item=>
  "<article class='forum-mod-item'><strong>Membership request</strong>"+
   "<small>"+escape(item.user_id)+" · "+escape(preferredDate(item.created_at))+"</small>"+
   (item.note?"<p>"+escape(item.note)+"</p>":"")+
   "<div><button type='button' data-join-review='"+escape(item.user_id)+"' data-join-approve='true'>Approve</button>"+
   "<button type='button' data-join-review='"+escape(item.user_id)+"' data-join-approve='false'>Decline</button></div></article>"
 ).join("")||"<p class='forum-muted'>No membership requests pending.</p>";
}
async function reviewAutoContent(id,type,action){
 const board=state.activeCommunity;if(!board||!isCommunityStaff(board.id))return;
 const {error}=await supabase.rpc("community_review_content",{
  p_id:id,p_type:type,p_action:action
 });
 if(error){notify(error.message,true);return;}
 await loadAutomodQueue(board.id);
 notify(action==="approve"?"Content approved.":"Content removed.");
}
async function reviewCommunityJoin(id,approve){
 const board=state.activeCommunity;if(!board||!isCommunityStaff(board.id))return;
 const {error}=await supabase.rpc("community_review_join",{
   p_community:board.id,p_member:id,p_approve:approve
 });
 if(error){notify(error.message,true);return;}
 await Promise.all([loadJoinQueue(board.id),loadModeratorMembers(board.id)]);
 notify(approve?"Member approved.":"Membership request declined.");
}
async function loadModerationReports(boardId){
 const {data,error}=await supabase.from("community_reports")
  .select("id,target_type,target_id,reason,status,created_at")
  .eq("community_id",boardId).eq("status","pending")
  .order("created_at",{ascending:false}).limit(50);
 const host=$("forumReportsQueue");
 if(error){host.textContent=error.message;return;}
 host.innerHTML=(data||[]).map(r=>
  "<article class='forum-mod-item'><strong>"+escape(r.target_type)+" report</strong>"+
  "<p>"+escape(r.reason)+"</p><small>"+escape(preferredDate(r.created_at))+"</small>"+
  "<div><button type='button' data-review-report='"+escape(r.id)+"' data-resolution='reviewed'>Mark reviewed</button>"+
  "<button type='button' data-review-report='"+escape(r.id)+"' data-resolution='dismissed'>Dismiss</button></div></article>"
 ).join("")||"<p class='forum-muted'>No pending reports. Your community is all caught up.</p>";
}
async function loadModeratorMembers(boardId){
 const {data,error}=await supabase.from("community_members")
  .select("user_id,role,joined_at").eq("community_id",boardId)
  .order("joined_at",{ascending:false}).limit(50);
 const host=$("forumModeratorMembers");
 if(error){host.textContent=error.message;return;}
 let profiles=new Map();
 if((data||[]).length){
  const ids=(data||[]).map(row=>row.user_id);
  const lookup=await supabase.from("public_profiles")
    .select("id,display_name,username").in("id",ids);
  profiles=new Map((lookup.data||[]).map(p=>[p.id,p]));
 }
 const owner=state.platformStaff||state.memberRoles.get(boardId)==="owner";
 host.innerHTML=(data||[]).map(m=>{
  const p=profiles.get(m.user_id);
  const name=p?.display_name||p?.username||"Member";
  const editable=owner&&m.role!=="owner"&&m.user_id!==state.user?.id;
  return "<div class='forum-mod-member'><span><strong>"+escape(name)+"</strong><small>"+escape(m.role)+"</small></span>"+
  (editable?"<select data-set-role='"+escape(m.user_id)+"' aria-label='Role for "+escape(name)+"'>"+
    ["member","moderator"].map(role=>"<option value='"+role+"' "+(role===m.role?"selected":"")+">"+role+"</option>").join("")+
    "</select>":"")+
  (m.role!=="owner"&&m.user_id!==state.user?.id?
    "<button type='button' data-ban-author='"+escape(m.user_id)+"'>Ban</button>":"")+
  "</div>";
 }).join("")||"<p class='forum-muted'>No members found.</p>";
}
async function reviewForumReport(id,resolution){
 if(!state.activeCommunity||!isCommunityStaff(state.activeCommunity.id))return;
 const {error}=await supabase.rpc("community_review_report",{p_report:id,p_resolution:resolution});
 if(error){notify(error.message,true);return;}
 await loadModerationReports(state.activeCommunity.id);
 notify("Report marked as "+resolution+".");
}
async function changeForumRole(id,role){
 if(!state.activeCommunity||!isCommunityStaff(state.activeCommunity.id))return;
 const {error}=await supabase.rpc("community_set_member_role",{
  p_community:state.activeCommunity.id,p_member:id,p_role:role
 });
 if(error){notify(error.message,true);return;}
 await loadModeratorMembers(state.activeCommunity.id);
 notify("Community role updated.");
}
async function banForumMember(userId){
 const board=state.activeCommunity;
 if(!board||!isCommunityStaff(board.id)||userId===state.user?.id)return;
 if(!window.confirm("Ban this member from "+board.title+"? They will no longer be able to post here."))return;
 const reason=window.prompt("Reason for ban (visible to moderators):","Violation of community rules");
 if(reason===null)return;
 const {error}=await supabase.rpc("community_moderate_member",{
  p_community:board.id,p_member:userId,p_action:"ban",p_reason:reason
 });
 if(error){notify(error.message,true);return;}
 notify("Member banned from this community.");
}
async function savePostingPolicy(){
 const community=state.activeCommunity;
 if(!community||state.memberRoles.get(community.id)!=="owner")return;
 const policy=$("forumPostingPolicy")?.value;
 if(!["everyone","members","staff"].includes(policy))return;
 const {error}=await supabase.from("discussion_topics").update({posting_policy:policy})
 .eq("id",community.id).eq("author_id",state.user.id);
 if(error){notify(error.message,true);return;}
 community.posting_policy=policy;notify("Community posting settings updated.");
}
async function initializeFromUrl(){
 const params=new URLSearchParams(location.search);
 const thread=params.get("thread"),community=params.get("community"),legacy=params.get("topic");
 if(thread&&validId(thread))await openThread(thread,{push:false});
 else if(legacy&&validId(legacy)){
   const {data}=await supabase.from("community_legacy_redirects")
     .select("thread_id").eq("old_topic_id",legacy).maybeSingle();
   if(data?.thread_id)await openThread(data.thread_id,{push:false});
   else enterFeed({mode:"home",push:false});
 }
 else if(community)await openCommunitySlug(community,{push:false});
 else if(params.get("mytech")==="1")enterFeed({mode:"personal",push:false});
 else enterFeed({mode:"home",push:false});
}
function bindEvents(){
 document.body.addEventListener("click",async event=>{
  const element=event.target.closest("button,a");if(!element)return;
  const data=element.dataset;
  if(data.openCommunity){event.preventDefault();await openCommunity(data.openCommunity);return;}
  if(data.openThread){await openThread(data.openThread);return;}
  if(data.copyInvite){
   const invite=new URL("discussion.html",location.href);
   invite.searchParams.set("community",data.copyInvite);
   try{
     await navigator.clipboard.writeText(invite.href);
     notify("Invite link copied. New members must be approved by moderators.");
   }catch(error){notify("Could not copy invite link.",true);}
   return;
  }
  if(data.privateInvite){
   if(!mustLogin())return;
   const {error}=await supabase.rpc("community_request_join",{
      p_community:data.privateInvite,p_note:""
   });
   if(error){notify(error.message||"Could not request membership.",true);return;}
   $("forumMembershipNotice").textContent="Membership request sent. A moderator must approve you.";
   notify("Request sent.");
   return;
  }
  if(data.forumNav){state.activeCommunity=null;enterFeed({mode:data.forumNav});return;}
  if(data.category){state.selectedCategory=data.category;renderCategories();try{await loadCommunities(true);}catch(e){notify(e.message,true);}return;}
  if(data.forumSort){
   state.sort=data.forumSort;
   document.querySelectorAll("[data-forum-sort]").forEach(b=>b.setAttribute("aria-pressed",String(b===element)));
   await loadFeed(true);return;
  }
  if(data.vote){await voteThread(data.id,Number(data.vote));return;}
  if(data.voteReply){await voteCommunityReply(data.voteReply,Number(data.replyVoteValue));return;}
  if(data.saveThread){await toggleSave(data.saveThread);return;}
  if(data.copyThread){await shareThread(data.copyThread);return;}
  if(data.reportThread){openForumReport("thread",data.reportThread);return;}
  if(data.reportReply){openForumReport("reply",data.reportReply);return;}
  if(data.notInterested){await hideRecommendation(data.notInterested);return;}
  if(data.forumPollVote){await castCommunityPollVote(Number(data.forumPollVote));return;}
  if(data.reviewReport){await reviewForumReport(data.reviewReport,data.resolution);return;}
  if(data.autoReview){await reviewAutoContent(data.autoReview,data.autoType,data.autoAction);return;}
  if(data.joinReview){await reviewCommunityJoin(data.joinReview,data.joinApprove==="true");return;}
  if(data.banAuthor){await banForumMember(data.banAuthor);return;}
  if(data.replyTo){startReply(data.replyTo);return;}
  if(data.cancelReply!==undefined){state.replyTo=null;$("forumReplyTarget").hidden=true;return;}
  if(data.jumpReply){
   document.getElementById("reply-"+data.jumpReply)?.scrollIntoView({behavior:"smooth",block:"center"});return;
  }
  if(data.copyReply){const url=new URL(location.href);url.hash="reply-"+data.copyReply;
    await navigator.clipboard.writeText(url.href);notify("Reply link copied.");return;}
  if(data.createTopic!==undefined){showDialog("forumThreadDialog");return;}
  if(data.closeForumDialog!==undefined){element.closest("dialog")?.close();}
 });
 $("forumCommunitySearch").addEventListener("input",()=>{
  clearTimeout(window.__communitySearchTimer);
  window.__communitySearchTimer=setTimeout(async()=>{
   state.communitySearch=$("forumCommunitySearch").value;
   try{await loadCommunities(true);}catch(e){notify(e.message,true);}
  },300);
 });
 $("forumThreadSearch").addEventListener("input",()=>{
  clearTimeout(window.__forumThreadSearchTimer);
  window.__forumThreadSearchTimer=setTimeout(()=>{
   state.search=$("forumThreadSearch").value.trim();void loadFeed(true);
  },300);
 });
 $("moreCommunities").addEventListener("click",async()=>{
  state.communityPage++;try{await loadCommunities(false);}catch(e){notify(e.message,true);}
 });
 $("forumLoadMore").addEventListener("click",()=>void loadFeed(false));
 $("forumMoreReplies").addEventListener("click",()=>void loadReplies(false));
 $("forumJoinButton").addEventListener("click",toggleJoin);
 $("forumModerationButton").addEventListener("click",()=>void openModerationWorkspace());
 $("forumModerationDialog").addEventListener("change",e=>{
   const select=e.target.closest("[data-set-role]");
   if(select)void changeForumRole(select.dataset.setRole,select.value);
 });
 $("forumBackButton").addEventListener("click",()=>{
  enterFeed({community:state.activeCommunity,mode:state.activeCommunity?"community":"home"});
 });
 $("forumRefreshReplies").addEventListener("click",()=>void loadReplies(true));
 $("createThreadButton").addEventListener("click",()=>showDialog("forumThreadDialog"));
 $("createCommunityButton").addEventListener("click",()=>showDialog("forumCommunityDialog"));
 $("forumCommunityForm").addEventListener("submit",createCommunity);
 $("forumInterestForm").addEventListener("submit",submitInterests);
 $("forumInterestButton").addEventListener("click",showInterestEditor);
 $("forumAddPollOption").addEventListener("click",()=>{
  const container=$("forumPollOptions");
  if(container.querySelectorAll("input").length>=6)return;
  const field=document.createElement("input");field.name="poll_option";
  field.maxLength=120;field.placeholder="Option "+(container.querySelectorAll("input").length+1);
  container.append(field);
 });
 document.querySelectorAll("[data-format-toolbar]").forEach(toolbar=>{
  const field=$(toolbar.dataset.formatToolbar);
  toolbar.addEventListener("click",event=>{
    const btn=event.target.closest("button");if(!btn)return;
    if(btn.dataset.format)insertCommunityFormatting(field,btn.dataset.format);
    if(btn.dataset.togglePreview)showMarkdownPreview(toolbar.dataset.formatToolbar,btn.dataset.togglePreview);
  });
  field?.addEventListener("input",updateAllVisiblePreviews);
 });
 $("forumReportForm").addEventListener("submit",submitForumReport);
 $("forumThreadForm").addEventListener("submit",createThread);
 $("forumReplyForm").addEventListener("submit",submitReply);
 $("forumThreadActions").addEventListener("change",event=>{
  if(event.target.id==="forumModerateAction"){
   const action=event.target.value;event.target.value="";
   void moderateThread(action);
  }
 });
 $("forumCommunityDetails").addEventListener("click",e=>{
  if(e.target.id==="forumSaveCommunityRules")void savePostingPolicy();
 });
 for(const dialog of [$("forumThreadDialog"),$("forumCommunityDialog"),$("forumReportDialog"),$("forumModerationDialog"),$("forumInterestDialog")]) {
  dialog.addEventListener("click",event=>{
   if(event.target===dialog)dialog.close();
  });
 }
 addEventListener("popstate",()=>void initializeFromUrl());
 setupMentionInput($("forumReplyText"));
 setupMentionInput($("forumThreadForm").querySelector("[name=body]"));
}
async function boot(){
 renderCategories();bindEvents();
 try{
   state.user=await getCurrentUser();
   if(state.user){
     const role=String(state.user.app_metadata?.role||"").toLowerCase();
     const {data}=await supabase.from("profiles").select("role").eq("id",state.user.id).maybeSingle();
     state.platformStaff=["admin","super"].includes(role)||["admin","super"].includes(String(data?.role||"").toLowerCase());
   }
 }catch(error){console.warn("Forum account unavailable",error);}
 authPanel();
 await Promise.all([loadMemberships(),loadInterests()]);
 try{await loadCommunities(true);}catch(error){notify("Cannot load community directory right now.",true);}
 await initializeFromUrl();
 if(new URLSearchParams(location.search).get("interests")==="1"&&state.user)showInterestEditor();
}
boot().catch(error=>{reportAppError(error,"Community forum failed to start");notify("Could not load communities. Refresh to try again.",true);});
