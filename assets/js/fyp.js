import { supabase, getCurrentUser } from "./supabase.js";
import { loadUserPreferences, mergePreferences } from "./user-preferences.js";
import { escapeHTML, clampText, stripHTML, isSafeUrl, timeAgo, reportAppError } from "./utils.js";
import { diversifyFeed, feedCacheKey, cachedFeed } from "./feed-diversity.mjs";

const state = { user: null, preferences: mergePreferences(), type: "all", mode: "for-you", loading: false };
const feedCache = new Map();
const suppressedContent = new Set();
const $ = (id) => document.getElementById(id);

function rememberKey(userId) { return `timzee:fyp:last:${userId}`; }
function readQuery() {
  const params = new URLSearchParams(window.location.search);
  return { type: params.get("type") || "", mode: params.get("mode") || "" };
}
function readRemembered(userId) {
  if (!userId || !state.preferences.feed.rememberFilters) return { type: "all", mode: "" };
  try { return JSON.parse(localStorage.getItem(rememberKey(userId)) || "{}"); } catch (_) { return {}; }
}
function saveRemembered() {
  if (!state.user?.id || !state.preferences.feed.rememberFilters) return;
  try { localStorage.setItem(rememberKey(state.user.id), JSON.stringify({ type: state.type, mode: state.mode })); } catch (_) {}
}
function typeLabel(type) {
  return ({ all: "Everything", post: "Posts", discussion: "Discussions", video: "Videos", novel: "Novels", marketplace: "Marketplace" })[type] || "Everything";
}
function contentHref(row) {
  if (row.content_type === "post") return `post.html?id=${encodeURIComponent(row.content_id)}`;
  if (row.content_type === "discussion") return `discussion.html?topic=${encodeURIComponent(row.content_id)}`;
  if (row.content_type === "video") return `video.html?id=${encodeURIComponent(row.content_id)}`;
  if (row.content_type === "novel") return `novel.html?id=${encodeURIComponent(row.content_id)}`;
  if (row.content_type === "marketplace") return `listing.html?id=${encodeURIComponent(row.content_id)}`;
  return "#";
}
function renderRow(row) {
  const type=row.content_type,mediaUrl=row.video_url;
  const isVideo=type==="video" && mediaUrl && isSafeUrl(mediaUrl);
  const image=row.image_url && isSafeUrl(row.image_url)
    ? '<img src="'+escapeHTML(row.image_url)+'" alt="'+escapeHTML(row.title||"Story image")+'" loading="lazy">'
    : '<div class="fyp-media-fallback" aria-hidden="true">'+escapeHTML(typeLabel(type).toUpperCase())+'</div>';
  const media=isVideo ?
    '<video class="fyp-inline-video" controls playsinline preload="none"'+
      (row.image_url&&isSafeUrl(row.image_url)?' poster="'+escapeHTML(row.image_url)+'"':"")+
      ' src="'+escapeHTML(mediaUrl)+'" aria-label="'+escapeHTML(row.title||"Community video")+'"></video>' :
    '<a class="fyp-media" href="'+contentHref(row)+'" aria-label="Open '+escapeHTML(typeLabel(type))+'">'+image+'</a>';
  const reason=row.reason?'<span class="fyp-reason">'+escapeHTML(row.reason)+'</span>':"";
  const feedback=state.mode==="for-you"?
    '<button type="button" class="btn ghost sm" data-fyp-action="not-interested">Not interested</button>':"";
  const body=clampText(stripHTML(row.excerpt||""),270);
  const interact=["post","video"].includes(type);
  const social=interact?'<div class="fyp-social-actions">'+
    '<button type="button" class="btn ghost sm fyp-like" aria-pressed="false" data-fyp-action="like">♡ Like</button>'+
    '<button type="button" class="btn ghost sm" data-fyp-action="comments" aria-expanded="false">Comments</button>'+
    '<a class="btn ghost sm" href="'+contentHref(row)+'">View full '+(type==="video"?"video":"post")+'</a></div>'+
    '<section class="fyp-comments" hidden><h3>Comments</h3><div class="fyp-comment-list"></div>'+
    '<form class="fyp-comment-form"><label for="fyp-comment-'+escapeHTML(row.content_id)+'">Add a comment</label>'+
    '<textarea id="fyp-comment-'+escapeHTML(row.content_id)+'" name="comment" required minlength="1" maxlength="1500" rows="3" placeholder="Join the discussion respectfully"></textarea>'+
    '<button type="submit" class="btn sm">Post comment</button></form><div class="fyp-comment-status" role="status"></div></section>':"";
  return '<article class="fyp-card" data-content-type="'+escapeHTML(type)+'" data-content-id="'+escapeHTML(row.content_id)+'">'+
    media+'<div class="fyp-card-body"><div class="fyp-meta"><span class="chip">'+escapeHTML(typeLabel(type))+
    '</span><span>'+escapeHTML(row.category||"")+'</span><span>'+timeAgo(row.created_at)+'</span></div>'+
    '<a href="'+contentHref(row)+'"><h2>'+escapeHTML(row.title||"Untitled")+'</h2></a>'+
    '<p>'+escapeHTML(body)+'</p>'+social+
    '<div class="fyp-card-foot">'+reason+feedback+'</div></div></article>';
}
async function enrichVideoItems(rows){
  const ids=[...new Set(rows.filter(r=>r.content_type==="video").map(r=>r.content_id))].slice(0,40);
  if(!ids.length)return rows;
  const {data,error}=await supabase.from("videos")
    .select("id,video_url,thumbnail_url,title,is_public").in("id",ids).eq("is_public",true);
  if(error){console.warn("Unable to load inline video sources",error.message);return rows;}
  const index=new Map((data||[]).map(v=>[v.id,v]));
  return rows.map(row=>{
    if(row.content_type!=="video")return row;
    const video=index.get(row.content_id);
    return {...row,video_url:video?.video_url||null,image_url:video?.thumbnail_url||row.image_url};
  });
}
async function hydrateLikes(root){
  if(!state.user?.id)return;
  const cards=[...root.querySelectorAll('.fyp-card[data-content-type="post"],.fyp-card[data-content-type="video"]')];
  await Promise.all(["post","video"].map(async type=>{
    const ids=cards.filter(c=>c.dataset.contentType===type).map(c=>c.dataset.contentId);
    if(!ids.length)return;
    const table=type==="post"?"post_likes":"video_likes";
    const col=type==="post"?"post_id":"video_id";
    const {data,error}=await supabase.from(table).select(col).eq("user_id",state.user.id).in(col,ids);
    if(error)return;
    const liked=new Set((data||[]).map(row=>row[col]));
    cards.filter(c=>c.dataset.contentType===type).forEach(card=>{
      const btn=card.querySelector('[data-fyp-action="like"]');
      if(!btn)return;
      const active=liked.has(card.dataset.contentId);
      btn.setAttribute("aria-pressed",String(active));
      btn.textContent=active?"♥ Liked":"♡ Like";
    });
  }));
}
async function toggleLike(card,button){
  const type=card.dataset.contentType,id=card.dataset.contentId;
  if(!["post","video"].includes(type)||!state.user?.id)return;
  const table=type==="post"?"post_likes":"video_likes",col=type==="post"?"post_id":"video_id";
  const active=button.getAttribute("aria-pressed")==="true";
  button.disabled=true;
  try{
    const query=active?supabase.from(table).delete().eq(col,id).eq("user_id",state.user.id):
      supabase.from(table).insert({[col]:id,user_id:state.user.id});
    const {error}=await query;
    if(error)throw error;
    button.setAttribute("aria-pressed",String(!active));
    button.textContent=active?"♡ Like":"♥ Liked";
    feedCache.clear();
  }catch(error){
    const feedback=card.querySelector(".fyp-comment-status");
    if(feedback)feedback.textContent="Couldn't update your like. Please try again.";
    reportAppError(error,"For You like failed");
  }finally{button.disabled=false;}
}
async function loadInlineComments(card){
  const type=card.dataset.contentType,id=card.dataset.contentId;
  const panel=card.querySelector(".fyp-comments");
  if(!panel)return;
  const table=type==="video"?"video_comments":"comments";
  const column=type==="video"?"video_id":"post_id";
  const query=supabase.from(table).select("id,author_name,body,created_at")
    .eq(column,id).order("created_at",{ascending:false}).limit(20);
  if(type==="post")query.eq("status","approved");
  const {data,error}=await query;
  const list=panel.querySelector(".fyp-comment-list");
  list.replaceChildren();
  if(error){list.textContent="Comments couldn't load right now.";return;}
  if(!(data||[]).length){list.textContent="No comments yet. Start the conversation.";return;}
  for(const comment of data){
    const article=document.createElement("article");article.className="fyp-comment-item";
    const name=document.createElement("strong");name.textContent=String(comment.author_name||"Member").replace(/<[^>]*>/g,"").slice(0,70);
    const body=document.createElement("p");body.textContent=comment.body||"";
    article.append(name,body);list.append(article);
  }
}
async function submitInlineComment(card,form){
  const type=card.dataset.contentType,id=card.dataset.contentId;
  const body=form.elements.comment?.value?.trim()||"";
  const status=card.querySelector(".fyp-comment-status");
  if(!body||body.length>1500){status.textContent="Enter a comment under 1,500 characters.";return;}
  if(!state.user?.id){status.textContent="Please sign in first.";return;}
  const isVideo=type==="video";
  const payload=isVideo?{video_id:id,user_id:state.user.id,author_name:state.user.user_metadata?.display_name||"Member",body}:
    {post_id:id,author_id:state.user.id,author_name:state.user.user_metadata?.display_name||"Member",body,status:"pending"};
  const submit=form.querySelector('button[type="submit"]');submit.disabled=true;
  try{
    const {error}=await supabase.from(isVideo?"video_comments":"comments").insert(payload);
    if(error)throw error;
    form.reset();
    status.textContent=isVideo?"Comment posted.":"Comment submitted for moderation.";
    await loadInlineComments(card);
  }catch(error){status.textContent="Couldn't post your comment. Please try again.";reportAppError(error,"Inline comment failed");}
  finally{submit.disabled=false;}
}
function updateUrl() {
  const params = new URLSearchParams();
  if (state.mode !== "for-you") params.set("mode", state.mode);
  if (state.type !== "all") params.set("type", state.type);
  window.history.replaceState({}, "", `fyp.html${params.toString() ? `?${params}` : ""}`);
}
function applyActiveControls() {
  document.querySelectorAll("[data-fyp-mode]").forEach(button => {
    const active = button.dataset.fypMode === state.mode;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  document.querySelectorAll("[data-fyp-filter]").forEach(button => {
    const active = button.dataset.fypFilter === state.type;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });
  const label = $("fypModeLabel");
  if (label) label.textContent = state.mode === "following" ? "Following" : "For You";
}
let feedVersion = 0;
async function loadFeed({ force = false } = {}) {
  const version = ++feedVersion;
  const target = $("fypGrid");
  if (!target) return;
  state.loading = true;
  target.setAttribute("aria-busy", "true");
  target.innerHTML = `<div class="callout">Building your ${state.mode === "following" ? "following" : "personalized"} feed…</div>`;
  const refresh = $("refreshFypBtn");
  if (refresh) refresh.disabled = true;
  const mode = state.mode, type = state.type;
  try {
    if (mode === "for-you" && !state.preferences.feed.showRecommendations) {
      target.innerHTML = `<div class="fyp-empty card"><h2>Recommendations are off</h2><p>Your For You feed is paused in settings. Switch to Following or turn recommendations back on.</p><div class="settings-inline-actions"><button class="btn" type="button" data-fyp-mode="following">Open Following</button><a class="btn ghost" href="settings.html#feed">Open feed settings</a></div></div>`;
      target.querySelector('[data-fyp-mode="following"]')?.addEventListener("click", () => {
        state.mode = "following"; saveRemembered(); updateUrl(); applyActiveControls(); void loadFeed();
      });
      return;
    }
    const key = feedCacheKey(mode, type);
    let rows = !force ? cachedFeed(feedCache, key) : null;
    if (!rows) {
      const rpcName = mode === "following" ? "get_following_feed" : "get_personalized_feed";
      const response = await supabase.rpc(rpcName, {
        p_limit: 40, p_content_type: type === "all" ? "all" : type
      });
      if (version !== feedVersion) return;
      if (response.error) throw response.error;
      rows = diversifyFeed(response.data || [], { mode });
      feedCache.set(key, { time: Date.now(), rows });
    }
    if (version !== feedVersion) return;
    rows=await enrichVideoItems(rows);
    const visible = rows.filter(row => !suppressedContent.has(row.content_type + ":" + row.content_id));
    target.innerHTML = visible.length
      ? visible.map(renderRow).join("")
      : `<div class="fyp-empty card"><h2>${mode === "following" ? "Nothing from followed creators yet" : "No recommendations yet"}</h2><p>${mode === "following" ? "Follow creators or communities to see their updates here." : "Like posts, follow people and choose Not interested to improve future recommendations."}</p><a class="btn" href="index.html">Explore the community</a></div>`;
    if(visible.length)void hydrateLikes(target);
  } catch (error) {
    if (version !== feedVersion) return;
    target.innerHTML = '<div class="callout" role="alert">Unable to load your feed right now. <button class="btn ghost sm" type="button" id="retryFypBtn">Retry</button></div>';
    target.querySelector("#retryFypBtn")?.addEventListener("click", () => void loadFeed({ force: true }));
    console.warn("Feed loading failed:", error);
  } finally {
    if (version === feedVersion) {
      state.loading = false;
      target.setAttribute("aria-busy", "false");
      if (refresh) refresh.disabled = false;
    }
  }
}
async function markNotInterested(card) {
  if (!state.user || !card || card.dataset.feedbackPending === "true") return;
  const button = card.querySelector('[data-fyp-action="not-interested"]');
  const contentType = card.dataset.contentType, contentId = card.dataset.contentId;
  const key = contentType + ":" + contentId;
  card.dataset.feedbackPending = "true";
  if (button) { button.disabled = true; button.textContent = "Saving…"; }
  try {
    const result = await supabase.from("user_content_feedback").upsert({
      user_id: state.user.id, content_type: contentType,
      content_id: contentId, action: "not_interested"
    }, { onConflict: "user_id,content_type,content_id" });
    if (result.error) throw result.error;
    suppressedContent.add(key);
    feedCache.clear(); // Next recommendation request must use new feedback.
    card.remove();
    const notice = $("fypFeedbackStatus");
    if (notice) {
      notice.replaceChildren(document.createTextNode("This recommendation is hidden. "));
      const undo = document.createElement("button");
      undo.type = "button"; undo.className = "btn ghost sm"; undo.textContent = "Undo";
      undo.addEventListener("click", async () => {
        undo.disabled = true;
        const rollback = await supabase.from("user_content_feedback").delete()
          .eq("user_id", state.user.id).eq("content_type", contentType)
          .eq("content_id", contentId).eq("action", "not_interested");
        if (rollback.error) {
          undo.disabled = false;
          notice.firstChild.textContent = "Could not undo that choice. ";
          return;
        }
        suppressedContent.delete(key);
        feedCache.clear();
        notice.textContent = "Preference restored.";
        void loadFeed({ force: true });
      });
      notice.append(undo);
    }
  } catch (error) {
    if (button) { button.disabled = false; button.textContent = "Not interested"; }
    throw error;
  } finally {
    delete card.dataset.feedbackPending;
  }
}
function wire() {
  document.querySelectorAll("[data-fyp-mode]").forEach((button) => button.addEventListener("click", () => { state.mode = button.dataset.fypMode || "for-you"; saveRemembered(); updateUrl(); applyActiveControls(); void loadFeed(); }));
  document.querySelectorAll("[data-fyp-filter]").forEach((button) => button.addEventListener("click", () => { state.type = button.dataset.fypFilter || "all"; saveRemembered(); updateUrl(); applyActiveControls(); void loadFeed(); }));
  $("refreshFypBtn")?.addEventListener("click", () => void loadFeed({ force: true }));
  $("fypGrid")?.addEventListener("click",async event=>{
    const button=event.target.closest("[data-fyp-action]");
    if(!button)return;
    const card=button.closest(".fyp-card");if(!card)return;
    event.preventDefault();
    if(button.dataset.fypAction==="like"){await toggleLike(card,button);return;}
    if(button.dataset.fypAction==="comments"){
      const panel=card.querySelector(".fyp-comments");if(!panel)return;
      panel.hidden=!panel.hidden;button.setAttribute("aria-expanded",String(!panel.hidden));
      if(!panel.hidden)await loadInlineComments(card);
      return;
    }
    try{await markNotInterested(card);}catch(error){reportAppError(error,"Recommendation feedback failed");}
  });
  $("fypGrid")?.addEventListener("submit",async event=>{
    const form=event.target.closest(".fyp-comment-form");if(!form)return;
    event.preventDefault();
    await submitInlineComment(form.closest(".fyp-card"),form);
  });
}
async function boot() {
  state.user = await getCurrentUser();
  if (!state.user) { window.location.href = `login.html?next=${encodeURIComponent(window.location.href)}`; return; }
  state.preferences = mergePreferences(await loadUserPreferences(state.user));
  const query = readQuery();
  const remembered = readRemembered(state.user.id);
  state.type = query.type || remembered.type || "all";
  state.mode = query.mode === "following" ? "following" : query.mode === "for-you" ? "for-you" : remembered.mode === "following" ? "following" : state.preferences.feed.defaultFeed === "following" && !query.mode && !query.type && !remembered.mode ? "following" : "for-you";
  applyActiveControls(); wire(); await loadFeed();
}
boot().catch((error) => reportAppError(error, "For You page failed to initialize"));
