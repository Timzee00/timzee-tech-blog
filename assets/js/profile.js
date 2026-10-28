import { supabase, getCurrentUser, getCurrentUserWithRole, getDisplayName, getUserRole, signOut } from "./supabase.js";
import { uploadMedia } from "./media.js";
import {
  fetchBookmarks,
  fetchNotifications,
  deleteNotification,
  markNotificationRead,
  markAllNotificationsRead,
  createAdminRequest
} from "./data.js";
import { fetchSettings } from "./settings.js";
import { fetchThemeById, applyThemeVariables } from "./themes.js";
import {
  timeAgo,
  clampText,
  stripHTML,
  escapeHTML,
  getQueryParam,
  deriveLevel,
  isSafeUrl,
  extractErrorMessage,
  reportAppError
} from "./utils.js";
import { setupReveal } from "./reveal.js";
import { safeNotificationPath } from "./notification-links.mjs";
import {verifiedName,verifiedAvatar,verifiedLevel,verifiedLabel,verifiedFrameClasses,verifiedFrameStyle,FRAME_OPTIONS,FRAME_STYLES} from "./verified-identity.mjs";
import {mountReadingLibrary} from "./reader-library.mjs";
import "./nav.js";
import { submitModerationReport } from "./moderation-reports.mjs";

const state = {
  user: null,
  profile: null,
  viewingId: null,
  friendship: null,
  friendCount: null,
  friendSummary: [],
  followsCreator: false,
  staffMessageAccess: false,
  followersCount: 0,
  followingCount: 0,
  activity: {
    topics: [],
    comments: [],
    shares: [],
    posts: {}
  },
  bookmarks: [],
  notifications: [],
  visitorInsights: null,
  adminRequest: null
};

function sanitizeUsername(value = "") {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .replace(/^_+|_+$/g, "");
}

async function isUsernameAvailable(username, currentId) {
  if (!username) return true;
  const result = await supabase
    .from("profiles")
    .select("id")
    .ilike("username", username)
    .neq("id", currentId)
    .limit(1)
    .maybeSingle();
  return !result.data;
}

let setActiveProfileSection = null;
const VIDEO_PAGE = 24;
let profileVideoOffset = 0;
let profileVideosLoaded = false;
let profileVideosLoading = false;
async function loadProfileVideos({ append = false } = {}) {
  const target=document.getElementById("profileVideoGallery");
  const more=document.getElementById("profileVideoMore");
  if(!target || profileVideosLoading || !state.viewingId) return;
  profileVideosLoading=true;
  if(more)more.disabled=true;
  const offset=append?profileVideoOffset:0;
  try {
    const {data,error}=await supabase.from("videos")
      .select("id,title,thumbnail_url,view_count,created_at")
      .eq("user_id",state.viewingId).eq("is_public",true)
      .order("created_at",{ascending:false})
      .range(offset,offset+VIDEO_PAGE-1);
    if(error)throw error;
    const rows=data||[];
    if(!append)target.replaceChildren();
    if(!append && !rows.length) {
      const empty=document.createElement("div");empty.className="callout";
      empty.textContent="No public videos yet.";
      target.append(empty);
    }
    for(const video of rows) {
      const link=document.createElement("a");
      link.className="profile-video-tile";
      link.href="video.html?id="+encodeURIComponent(video.id);
      const media=document.createElement("div");media.className="profile-video-tile-media";
      if(video.thumbnail_url && isSafeUrl(video.thumbnail_url)){
        const img=document.createElement("img");img.src=video.thumbnail_url;
        img.alt="";img.loading="lazy";media.append(img);
      } else {
        const fallback=document.createElement("span");fallback.textContent="Video";media.append(fallback);
      }
      const views=document.createElement("span");views.className="profile-video-tile-views";
      views.textContent="▶ "+Number(video.view_count||0).toLocaleString();
      media.append(views);
      const title=document.createElement("span");title.className="profile-video-tile-title";
      title.textContent=video.title||"Untitled video";
      link.append(media,title);target.append(link);
    }
    profileVideoOffset=offset+rows.length;
    profileVideosLoaded=true;
    if(more)more.hidden=rows.length<VIDEO_PAGE;
  }catch(error){
    console.warn("Profile videos could not be loaded:",error);
    const note=document.createElement("div");note.className="callout";note.textContent="Videos could not load. Try again.";
    if(!append)target.replaceChildren(note);else target.append(note);
    if(more)more.hidden=false;
  }finally {profileVideosLoading=false;if(more)more.disabled=false;}
}
document.getElementById("profileVideoMore")?.addEventListener("click",()=>void loadProfileVideos({append:true}));


function renderAuthActions() {
  const actions = document.getElementById("authActions");
  if (!actions) return;
  actions.innerHTML = "";
  if (state.user) {
    const label = document.createElement("span");
    label.className = "auth-meta";
    label.textContent = getDisplayName(state.user);
    const role = getUserRole(state.user);
    if (["author", "moderator", "admin", "super"].includes(role)) {
      const authorPanel = document.createElement("a");
      authorPanel.className = "btn ghost";
      authorPanel.href = "author/dashboard.html";
      authorPanel.textContent = "Author Studio";
      actions.appendChild(authorPanel);
    }
    if (["moderator", "admin", "super"].includes(role)) {
      const modPanel = document.createElement("a");
      modPanel.className = "btn ghost";
      modPanel.href = "moderator/dashboard.html";
      modPanel.textContent = "Moderator Panel";
      actions.appendChild(modPanel);
    }
    if (["admin", "super"].includes(role)) {
      const adminPanel = document.createElement("a");
      adminPanel.className = "btn ghost";
      adminPanel.href = "admin/dashboard.html";
      adminPanel.textContent = "Admin Dashboard";
      actions.appendChild(adminPanel);
    }
    const chat = document.createElement("a");
    chat.className = "btn ghost";
    chat.href = "chat.html";
    chat.textContent = "Chat";
    const logout = document.createElement("button");
    logout.className = "btn ghost";
    logout.textContent = "Log Out";
    logout.addEventListener("click", async () => {
      await signOut();
      window.location.reload();
    });
    actions.appendChild(label);
    actions.appendChild(chat);
    actions.appendChild(logout);
  } else {
    const login = document.createElement("a");
    login.className = "btn ghost";
    login.href = "login.html?next=profile.html";
    login.textContent = "Log In";
    actions.appendChild(login);
  }
}

async function ensureProfile(user) {
  if (!user) return null;
  const existing = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
  if (!existing.error && existing.data) return existing.data;
  const fallbackName = getDisplayName(user);
  const fallbackEmail = user.email || "";
  const fallbackUsername = fallbackEmail ? fallbackEmail.split("@")[0] : fallbackName || "member";
  const payload = {
    id: user.id,
    display_name: fallbackName,
    username: user.user_metadata?.username || fallbackUsername,
    email: fallbackEmail,
    bio: "",
    avatar_url: "",
    role: "user",
    headline: "",
    location: "",
    website: "",
    cover_url: "",
    allow_messages: true,
    allow_requests: true,
    show_email: false,
    notify_messages: true,
    notify_replies: true,
    created_at: new Date().toISOString()
  };
  const created = await supabase.from("profiles").insert(payload).select().single();
  return created.data || null;
}

async function loadProfile(viewingId) {
  const result = await supabase.from("public_profiles").select("*").eq("id", viewingId).maybeSingle();
  return result.data || null;
}

async function loadFriendship() {
  if (!state.user || !state.viewingId || state.viewingId === state.user.id) return null;
  const result = await supabase
    .from("friendships")
    .select("*")
    .or(
      `and(requester_id.eq.${state.user.id},addressee_id.eq.${state.viewingId}),and(requester_id.eq.${state.viewingId},addressee_id.eq.${state.user.id})`
    )
    .maybeSingle();
  state.friendship = result.data || null;
}

async function loadFriendSummary() {
  state.friendCount = null;
  state.friendSummary = [];
  if (!state.user || state.viewingId !== state.user.id) return;
  const result = await supabase
    .from("friendships")
    .select("*")
    .eq("status", "accepted")
    .or(`requester_id.eq.${state.user.id},addressee_id.eq.${state.user.id}`);
  const friendships = result.data || [];
  const friendIds = friendships
    .map((row) => (row.requester_id === state.user.id ? row.addressee_id : row.requester_id))
    .filter(Boolean);
  state.friendCount = friendIds.length;
  if (!friendIds.length) return;
  const profiles = await supabase
    .from("public_profiles")
    .select("id, display_name, username, avatar_url, is_verified, verification_tier, verification_expires_at, frame_style")
    .in("id", friendIds);
  state.friendSummary = profiles.data || [];
}

function renderProfileAbout() {
  const about = document.getElementById("profileAbout");
  if (!about) return;
  const items = [];
  const headline = state.profile?.headline;
  const location = state.profile?.location;
  const website = state.profile?.website;
  const username = state.profile?.username;
  if (username) {
    items.push(`<div class="about-item"><span>Username</span>${escapeHTML(username)}</div>`);
  }
  if (headline) {
    items.push(`<div class="about-item"><span>Headline</span>${escapeHTML(headline)}</div>`);
  }
  if (location) {
    items.push(`<div class="about-item"><span>Location</span>${escapeHTML(location)}</div>`);
  }
  if (website) {
    const safeUrl = website.startsWith("http://") || website.startsWith("https://")
      ? website
      : `https://${website}`;
    if (safeUrl.startsWith("http://") || safeUrl.startsWith("https://")) {
      items.push(
        `<div class="about-item"><span>Website</span><a href="${safeUrl}" target="_blank" rel="noopener">${escapeHTML(website)}</a></div>`
      );
    }
  }
  if (state.profile?.show_email) {
    const email =
      state.user && state.user.id === state.viewingId
        ? state.user.email
        : state.profile?.email;
    if (email) {
      items.push(`<div class="about-item"><span>Email</span>${escapeHTML(email)}</div>`);
    }
  }
  if (state.profile?.created_at) {
    items.push(
      `<div class="about-item"><span>Member since</span>${new Date(
        state.profile.created_at
      ).toLocaleDateString()}</div>`
    );
  }
  if (!items.length) {
    about.innerHTML = "<div class=\"callout\">Add profile details to tell others about you.</div>";
    return;
  }
  about.innerHTML = items.join("");
}

function renderProfileFriends() {
  const list = document.getElementById("profileFriends");
  if (!list) return;
  if (!state.user || state.viewingId !== state.user.id) {
    list.innerHTML = "<div class=\"callout\">Friends list is private.</div>";
    return;
  }
  if (!state.friendSummary.length) {
    list.innerHTML = "<div class=\"callout\">No friends yet — start connecting.</div>";
    return;
  }
  list.innerHTML = state.friendSummary
    .slice(0, 6)
    .map(
      (friend) => `
        <div class="friend-pill">
          ${verifiedAvatar(friend.avatar_url,friend,{size:"sm",alt:"Friend portrait"})}
          <div class="friend-name">${verifiedName(friend.username || "Member",friend,{compact:true})}</div>
        </div>
      `
    )
    .join("");
}

function plainDisplayName(value) {
  const raw=String(value||"Member");
  const cleaned=raw.replace(/<[^>]*>/g,"").replace(/[<>]/g,"").trim();
  return cleaned && !/^(?:img\s+src|onerror\s*=)/i.test(cleaned) ? cleaned.slice(0,80) : "Member";
}
function setupProfilePhotoViewer(){
  const modal=document.getElementById("profileImageDialog");
  const image=document.getElementById("profileImageFull");
  if(!modal||!image)return;
  document.querySelectorAll("[data-profile-image]").forEach(button=>button.addEventListener("click",()=>{
    const kind=button.dataset.profileImage;
    const source=document.getElementById(kind==="cover"?"profileCoverImg":"profileAvatar");
    const url=source?.currentSrc||source?.src;
    if(!url || !isSafeUrl(url))return;
    image.src=url;
    image.alt=kind==="cover"?"Full cover photo":"Full profile photo";
    document.getElementById("profileImageCaption").textContent=kind==="cover"?"Cover photo":"Profile photo";
    if(!modal.open)modal.showModal();
  }));
  document.getElementById("closeProfileImage")?.addEventListener("click",()=>modal.close());
  modal.addEventListener("click",event=>{if(event.target===modal)modal.close();});
  modal.addEventListener("close",()=>image.removeAttribute("src"));
}
setupProfilePhotoViewer();

function renderProfile() {
  const avatar = document.getElementById("profileAvatar");
  const cover = document.getElementById("profileCoverImg");
  const name = document.getElementById("profileName");
  const bio = document.getElementById("profileBio");
  const role = document.getElementById("profileRole");
  const headline = document.getElementById("profileHeadline");
  const badgeWrap = document.getElementById("profileBadges");
  if (avatar) {
    avatar.src = state.profile?.avatar_url || "/assets/img/avatar-placeholder.svg";
  }
  if (cover) {
    cover.src = state.profile?.cover_url || "https://images.unsplash.com/photo-1482192596544-9eb780fc7f66?auto=format&fit=crop&w=1200&q=80";
  }
  const tier=verifiedLevel(state.profile);
  const hero=document.querySelector(".profile-page .profile-hero");
  const frame=document.querySelector(".profile-page .profile-avatar-wrap");
  if(hero){
    hero.classList.remove("tz-frame","tz-frame--silver","tz-frame--gold",
      "tz-frame--platinum","tz-frame--business");
    if(tier){
      hero.dataset.verificationLevel=tier;
      hero.classList.add("tz-frame","tz-frame--"+tier);
      hero.dataset.frameStyle=verifiedFrameStyle(state.profile);
    }else {delete hero.dataset.verificationLevel;delete hero.dataset.frameStyle;}
  }
  if(frame){
    frame.classList.remove("tz-frame","tz-frame--silver","tz-frame--gold","tz-frame--platinum",
      "tz-frame--business",...FRAME_STYLES.map(style=>"tz-frame--"+style));
    if(tier)frame.classList.add(...verifiedFrameClasses(state.profile).split(" "));
  }
  if (name) {
    const displayName = plainDisplayName(state.profile?.display_name || "Member");
    name.innerHTML = verifiedName(displayName,state.profile);
  }
  const handle=document.getElementById("profileHandle");
  if(handle)handle.textContent=state.profile?.username?"@"+state.profile.username:"";
  if (headline) {
    headline.textContent = state.profile?.headline || "Tech community member";
  }
  if (bio) bio.textContent = state.profile?.bio || "No bio yet.";
  if (role) role.textContent = state.profile?.role || "Member";
  if (badgeWrap) {
    const badges = [];
    if (state.profile?.is_featured) badges.push('<span class="badge-chip featured">Featured</span>');
    if (state.profile?.is_staff_pick) badges.push('<span class="badge-chip staff">Staff Pick</span>');
    badgeWrap.innerHTML = badges.join("");
  }
}

function renderVerification(){
  const target=document.getElementById("profileVerification");
  if(!target)return;
  const tier=verifiedLevel(state.profile);
  const isSelf=Boolean(state.user?.id&&state.user.id===state.viewingId);
  if(!tier){
    target.innerHTML='<div class="callout">No verified identity badge yet. All members can still participate in communities, chat and publish content.</div>'+
      (isSelf?'<a class="btn ghost sm" href="verify.html">Apply for verification</a> <a class="btn ghost sm" href="creator-studio.html">Creator Studio</a>':'');
    return;
  }
  const label=verifiedLabel(state.profile);
  const benefits={
    silver:["Original Silver badge across supported social surfaces","Silver profile frames and extended status eligibility","Identity and impersonation reporting tools"],
    gold:["Original Gold badge and profile themes","Creator publishing tools already available to this account","Verified status features and content insights"],
    platinum:["Original Platinum badge and premium frames","Professional creator experience","Existing verified publishing and community tools"],
    business:["Official Organization badge and branded profile frame","Organization identity shown across supported surfaces","Official account protection and content publishing"]
  };
  const current=verifiedFrameStyle(state.profile);
  const gallery=isSelf
    ? '<section class="tz-frame-selector" aria-label="Portrait frame collection">'+
      '<h4>My frame collection</h4>'+
      '<p class="tz-frame-preview-note">Choose a decoration to preview it on your full profile. Save to show it on comments, chats and communities.</p>'+
      '<div class="tz-frame-gallery" id="profileFrameGallery" role="group" aria-label="Choose a collectible frame">'+
      FRAME_OPTIONS.map(option=>{
        const preview={...state.profile,frame_style:option.id};
        return '<button type="button" class="tz-frame-choice" data-frame-choice="'+option.id+
          '" aria-label="Preview '+option.title+' frame" aria-pressed="'+String(option.id===current)+'">'+
          verifiedAvatar(state.profile?.avatar_url,preview,{size:"lg",alt:""})+
          '<strong>'+option.title+'</strong><small>'+option.description+'</small></button>';
      }).join("")+'</div>'+
      '<div class="tz-frame-actions"><button type="button" class="btn sm" id="saveProfileFrame">Apply selected frame</button>'+
      '<button type="button" class="btn ghost sm" id="cancelProfileFrame">Restore saved frame</button></div>'+
      '<p class="status" id="profileFrameStatus" role="status" aria-live="polite"></p></section>'
    : '';
  target.innerHTML='<div class="verification-tier">'+verifiedName(label,state.profile)+
    '</div><ul class="perk-list">'+benefits[tier].map(x=>'<li>'+escapeHTML(x)+'</li>').join("")+'</ul>'+(isSelf?'<div class="tz-frame-actions"><a class="btn ghost sm" href="creator-studio.html">Open Creator Studio</a></div>':'')+gallery;
  if(!isSelf)return;
  let selected=current;
  let frameSaving=false;
  const displayPreview=()=>{
    const preview={...state.profile,frame_style:selected};
    const hero=document.querySelector(".profile-page .profile-hero");
    const avatar=document.querySelector(".profile-page .profile-avatar-wrap");
    if(hero)hero.dataset.frameStyle=selected;
    if(avatar){
      avatar.classList.remove(...FRAME_STYLES.map(x=>"tz-frame--"+x));
      avatar.classList.add(...verifiedFrameClasses(preview).split(" ").filter(Boolean));
    }
    target.querySelectorAll("[data-frame-choice]").forEach(btn=>{
      btn.setAttribute("aria-pressed",String(btn.dataset.frameChoice===selected));
    });
    const save=document.getElementById("saveProfileFrame");
    if(save)save.disabled=frameSaving||selected===verifiedFrameStyle(state.profile);
    const restore=document.getElementById("cancelProfileFrame");
    if(restore)restore.disabled=frameSaving||selected===verifiedFrameStyle(state.profile);
    target.querySelectorAll("[data-frame-choice]").forEach(btn=>{btn.disabled=frameSaving;});
  };
  target.querySelector("#profileFrameGallery")?.addEventListener("click",event=>{
    const button=event.target.closest("[data-frame-choice]");
    if(frameSaving||!button||!FRAME_STYLES.includes(button.dataset.frameChoice))return;
    selected=button.dataset.frameChoice;
    displayPreview();
    document.getElementById("profileFrameStatus").textContent=
      FRAME_OPTIONS.find(option=>option.id===selected)?.title+" preview — not saved yet.";
  });
  document.getElementById("cancelProfileFrame")?.addEventListener("click",()=>{
    if(frameSaving)return;
    selected=verifiedFrameStyle(state.profile);displayPreview();
    document.getElementById("profileFrameStatus").textContent="Restored your saved frame.";
  });
  document.getElementById("saveProfileFrame")?.addEventListener("click",async event=>{
    const button=event.currentTarget;
    if(frameSaving||!state.user||!FRAME_STYLES.includes(selected)||selected===verifiedFrameStyle(state.profile))return;
    const status=document.getElementById("profileFrameStatus");
    const submittedFrame=selected;
    frameSaving=true;
    displayPreview();
    status.textContent="Applying frame securely…";
    try{
      const result=await supabase.from("profiles").update({frame_style:submittedFrame})
        .eq("id",state.user.id).select("frame_style").single();
      if(result.error)throw result.error;
      if(result.data?.frame_style!==submittedFrame)throw Error("The server did not confirm the selected frame.");
      state.profile.frame_style=result.data.frame_style;
      selected=result.data.frame_style;
      // Keep the existing gallery and its live region mounted: rebuilding the
      // verification section here would detach status and event listeners.
      displayPreview();
      status.textContent="Frame applied! Your decoration will appear across supported social surfaces.";
    }catch(error){
      status.textContent=extractErrorMessage(error,"Couldn't apply this frame. Your saved frame is unchanged.");
      displayPreview();
    }finally{
      frameSaving=false;
      displayPreview();
    }
  });
  displayPreview();
}

function setupProfileTabs() {
  const tabs = document.querySelectorAll("#profileTabs button");
  const sections = document.querySelectorAll("[data-profile-section]");
  if (!tabs.length || !sections.length) return;

  const isSelf = state.user && state.viewingId === state.user.id;
  if (!isSelf) {
    tabs.forEach((btn) => {
      if (["settings", "bookmarks", "notifications"].includes(btn.dataset.tab)) {
        btn.style.display = "none";
      }
    });
  }

  const setActive = (tabId) => {
    if (!isSelf && ["settings", "bookmarks", "notifications"].includes(tabId)) {
      tabId = "overview";
    }
    tabs.forEach((btn) => {
      const active=btn.dataset.tab===tabId;
      btn.classList.toggle("active",active);
      btn.setAttribute("aria-pressed",String(active));
    });
    if(tabId==="videos" && !profileVideosLoaded) void loadProfileVideos();
    sections.forEach((section) => {
      section.classList.toggle("active", section.dataset.profileSection === tabId);
    });
  };
  setActiveProfileSection = setActive;

  tabs.forEach((btn) => {
    btn.addEventListener("click", () => setActive(btn.dataset.tab));
  });

  const params = new URLSearchParams(window.location.search);
  const defaultTab = params.get("tab") || "overview";
  setActive(defaultTab);
}

async function loadCreatorFollows() {
  if (!state.viewingId) return;
  const followerQuery=supabase.from("follows").select("id",{count:"exact",head:true})
    .eq("target_type","author").eq("target_id",state.viewingId);
  const followingQuery=supabase.from("follows").select("id",{count:"exact",head:true})
    .eq("follower_id",state.viewingId).eq("target_type","author");
  const ownQuery=state.user?.id && state.user.id!==state.viewingId
    ? supabase.from("follows").select("id").eq("follower_id",state.user.id)
        .eq("target_type","author").eq("target_id",state.viewingId).maybeSingle()
    : Promise.resolve({data:null,error:null});
  const [followers,following,own]=await Promise.all([followerQuery,followingQuery,ownQuery]);
  if(followers.error || following.error || own.error) {
    console.warn("Follow summary is unavailable",followers.error||following.error||own.error);
    return;
  }
  state.followersCount=followers.count||0;
  state.followingCount=following.count||0;
  state.followsCreator=Boolean(own.data);
}

async function toggleCreatorFollow(button) {
  if(!state.user || state.user.id===state.viewingId)return;
  button.disabled=true;
  const wasFollowing=state.followsCreator;
  try{
    const query=supabase.from("follows");
    const result=wasFollowing
      ? await query.delete().eq("follower_id",state.user.id)
          .eq("target_type","author").eq("target_id",state.viewingId)
      : await query.insert({
          id:crypto.randomUUID(),follower_id:state.user.id,
          target_type:"author",target_id:state.viewingId
        });
    if(result.error)throw result.error;
    state.followsCreator=!wasFollowing;
    state.followersCount=Math.max(0,state.followersCount+(wasFollowing?-1:1));
    renderProfileStats();renderProfileActions();
  }catch(error) {
    console.warn("Creator follow update failed",error);
    window.appUI?.toast?.("Could not update creator follow. Please retry.",{type:"error"});
    button.disabled=false;
  }
}

function renderProfileStats() {
  const stats = document.getElementById("profileStats");
  if (!stats) return;
  const friendValue = typeof state.friendCount === "number" ? state.friendCount : "Private";
  const points = state.profile?.points || 0;
  const level = state.profile?.level || deriveLevel(points).label;
  stats.innerHTML = [
    { label: "Topics", value: state.activity.topics.length },
    { label: "Comments", value: state.activity.comments.length },
    { label: "Shares", value: state.activity.shares.length },
    { label: "Followers", value: state.followersCount },
    { label: "Following", value: state.followingCount },
    { label: "Friends", value: friendValue },
    ...(state.user?.id===state.viewingId && state.visitorInsights ? [{label:"Profile views · 7 days",value:state.visitorInsights.last_7_days||0}]:[]),
    { label: "Reputation", value: `${points} · ${level}` }
  ]
    .map(
      (item) => `
      <div class="stats-item">
        <span>${escapeHTML(item.label)}</span>
        <strong>${item.value}</strong>
      </div>
    `
    )
    .join("");
}

function renderActivity() {
  const topicsEl = document.getElementById("profileTopics");
  const commentsEl = document.getElementById("profileComments");
  const sharesEl = document.getElementById("profileShares");

  if (topicsEl) {
    topicsEl.innerHTML = state.activity.topics.length
      ? state.activity.topics
          .slice(0, 6)
          .map(
            (topic) => `
        <div class="activity-item">
          <a href="discussion.html?topic=${topic.id}"><strong>${escapeHTML(topic.title)}</strong></a>
          <div class="topic-meta">${timeAgo(topic.created_at)}</div>
          <div>${escapeHTML(clampText(topic.description || "", 120))}</div>
        </div>
      `
          )
          .join("")
      : "<div class=\"callout\">No topics yet.</div>";
  }

  if (commentsEl) {
    commentsEl.innerHTML = state.activity.comments.length
      ? state.activity.comments
          .slice(0, 6)
          .map((comment) => {
            const post = state.activity.posts[comment.post_id];
            return `
          <div class="activity-item">
            <a href="post.html?id=${comment.post_id}"><strong>${escapeHTML(
              post?.title || "Post"
            )}</strong></a>
            <div class="topic-meta">${timeAgo(comment.created_at)}</div>
            <div>${escapeHTML(clampText(stripHTML(comment.body || ""), 120))}</div>
          </div>
        `;
          })
          .join("")
      : "<div class=\"callout\">No comments yet.</div>";
  }

  if (sharesEl) {
    sharesEl.innerHTML = state.activity.shares.length
      ? state.activity.shares
          .slice(0, 6)
          .map((share) => {
            const post = state.activity.posts[share.post_id];
            return `
          <div class="activity-item">
            <a href="post.html?id=${share.post_id}"><strong>${escapeHTML(
              post?.title || "Post"
            )}</strong></a>
            <div class="topic-meta">${timeAgo(share.created_at)} · ${escapeHTML(
              share.channel || "share"
            )}</div>
          </div>
        `;
          })
          .join("")
      : "<div class=\"callout\">No shares yet.</div>";
  }
}

function renderBookmarks() {
  const list = document.getElementById("profileBookmarks");
  if (!list) return;
  if (!state.user || state.viewingId !== state.user.id) {
    list.innerHTML = "<div class=\"callout\">Bookmarks are private.</div>";
    return;
  }
  if (!state.bookmarks.length) {
    list.innerHTML = "<div class=\"callout\">No saved posts yet — bookmark something you love.</div>";
    return;
  }
  list.innerHTML = state.bookmarks
    .map((item) => {
      const post = item.posts || {};
      return `
        <div class="activity-item">
          <a href="post.html?id=${item.post_id}"><strong>${escapeHTML(
            post.title || "Saved post"
          )}</strong></a>
          <div class="topic-meta">Saved ${timeAgo(item.created_at)}</div>
        </div>
      `;
    })
    .join("");
}

const NOTIFICATION_CATEGORIES = {
  messages: ["direct_message"],
  social: [
    "friend_request",
    "friend_request_accepted",
    "post_like",
    "video_like",
    "video_comment",
    "mention",
    "comment_reply",
    "discussion_reply",
    "reply"
  ],
  activity: ["admin_promotion", "verification_status", "profile_view"]
};

let activeNotificationTab = "all";

function setupNotificationTabs() {
  const tabs = document.querySelectorAll("#notificationTabs .chat-tab");
  if (!tabs.length) return;
  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activeNotificationTab = tab.dataset.notifTab;
      tabs.forEach((t) => {
        const active = t === tab;
        t.classList.toggle("active", active);
        t.setAttribute("aria-selected", active ? "true" : "false");
      });
      renderNotifications();
    });
  });
}

function renderNotifications() {
  const list = document.getElementById("profileNotifications");
  if (!list) return;
  if (!state.user || state.viewingId !== state.user.id) {
    list.innerHTML = "<div class=\"callout\">Notifications are private.</div>";
    return;
  }
  const filtered =
    activeNotificationTab === "all"
      ? state.notifications
      : state.notifications.filter((note) =>
          (NOTIFICATION_CATEGORIES[activeNotificationTab] || []).includes(note.type)
        );
  if (!filtered.length) {
    list.innerHTML = "<div class=\"callout\">No notifications here yet.</div>";
    return;
  }
  list.innerHTML = filtered
    .map((note) => {
      const unread = !note.read_at;
      const title = escapeHTML(note.title || "Notification");
      const body = escapeHTML(note.body || "");
      const timeLabel = timeAgo(note.created_at);
      const linkTarget = safeNotificationPath(note.link || note.link_url || "", location.origin);
      const link = linkTarget ? `<a href="${escapeHTML(linkTarget)}">Open</a>` : "";
      return `
        <div class="notification-item ${unread ? "unread" : ""}" data-id="${note.id}">
          <strong>${title}</strong>
          <div>${body}</div>
          <div class="leaderboard-meta">
            <span>${timeLabel}</span>
            ${link}
            <button type="button" class="notification-delete-btn" data-delete-id="${note.id}" aria-label="Delete notification">&times;</button>
          </div>
        </div>
      `;
    })
    .join("");

  list.querySelectorAll(".notification-item").forEach((item) => {
    item.addEventListener("click", async (event) => {
      if (event.target.closest(".notification-delete-btn")) return;
      const id = item.dataset.id;
      if (!id) return;
      await markNotificationRead(id);
      item.classList.remove("unread");
    });
  });

  list.querySelectorAll(".notification-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async (event) => {
      event.stopPropagation();
      const id = btn.dataset.deleteId;
      if (!id) return;
      const result = await deleteNotification(id);
      if (result.error) {
        console.warn("Delete notification failed:", result.error);
        return;
      }
      state.notifications = state.notifications.filter((n) => n.id !== id);
      renderNotifications();
    });
  });
}

async function sendFriendRequest() {
  if (!state.user || !state.viewingId) return;
  await supabase.from("friendships").insert({
    id: crypto.randomUUID(),
    requester_id: state.user.id,
    requester_name: getDisplayName(state.user),
    addressee_id: state.viewingId,
    status: "pending",
    created_at: new Date().toISOString()
  });
  await loadFriendship();
  renderProfileActions();
}

async function acceptFriendRequest() {
  if (!state.friendship) return;
  await supabase
    .from("friendships")
    .update({ status: "accepted", updated_at: new Date().toISOString() })
    .eq("id", state.friendship.id);
  await loadFriendship();
  renderProfileActions();
}

async function declineFriendRequest() {
  if (!state.friendship) return;
  await supabase.from("friendships").delete().eq("id", state.friendship.id);
  state.friendship = null;
  renderProfileActions();
}

async function removeFriendship() {
  if (!state.friendship) return;
  if (!await window.appUI.confirm("Remove this friend?")) return;
  await supabase.from("friendships").delete().eq("id", state.friendship.id);
  state.friendship = null;
  renderProfileActions();
}

async function blockUser() {
  if (!state.user || !state.viewingId) return;
  if (!await window.appUI.confirm("Block this user? You will no longer receive messages.")) return;
  const now = new Date().toISOString();
  if (state.friendship) {
    await supabase
      .from("friendships")
      .update({ status: "blocked", blocked_by: state.user.id, updated_at: now })
      .eq("id", state.friendship.id);
  } else {
    await supabase.from("friendships").insert({
      id: crypto.randomUUID(),
      requester_id: state.user.id,
      requester_name: getDisplayName(state.user),
      addressee_id: state.viewingId,
      status: "blocked",
      blocked_by: state.user.id,
      created_at: now,
      updated_at: now
    });
  }
  await loadFriendship();
  renderProfileActions();
}

async function unblockUser() {
  if (!state.friendship) return;
  await supabase.from("friendships").delete().eq("id", state.friendship.id);
  state.friendship = null;
  renderProfileActions();
}

function renderProfileActions() {
  const actions = document.getElementById("profileActions");
  if (!actions) return;
  actions.innerHTML = "";
  if (!state.user) {
    const login = document.createElement("a");
    login.className = "btn ghost";
    login.href = "login.html?next=profile.html";
    login.textContent = "Log in to connect";
    actions.appendChild(login);
    return;
  }
  const isSelf = state.user.id === state.viewingId;
  if (isSelf) {
    const edit = document.createElement("button");
    edit.className = "btn";
    edit.textContent = "Edit Profile";
    edit.addEventListener("click", () => {
      // First, switch to settings tab
      if (setActiveProfileSection) setActiveProfileSection("settings");
      // Then make sure the editor is visible
      const editor = document.getElementById("profileEditor");
      if (editor) {
        editor.style.display = "block";
        editor.scrollIntoView({ behavior: "smooth", block: "start" });
      }
      // Mark settings tab as active
      const settingsBtn = document.querySelector('[data-tab="settings"]');
      if (settingsBtn) settingsBtn.click();
    });
    const chat = document.createElement("a");
    chat.className = "btn ghost";
    chat.href = "chat.html";
    chat.textContent = "Open Chat";
    actions.appendChild(edit);
    actions.appendChild(chat);
    const videosLink=document.createElement("a");videosLink.href="profile.html?tab=videos";
    videosLink.className="btn ghost";videosLink.textContent="My videos";
    actions.appendChild(videosLink);
    return;
  }

  const reportUserBtn=document.createElement("button");
  reportUserBtn.type="button";
  reportUserBtn.className="btn ghost";
  reportUserBtn.textContent="Report user";
  reportUserBtn.addEventListener("click",async()=>{
    const reason=await window.appUI.prompt("Why are you reporting this account? Please describe the issue.","");
    if(reason===null)return;
    reportUserBtn.disabled=true;
    try {
      await submitModerationReport({
        reporterId:state.user.id,contentType:"user",contentId:state.viewingId,reason
      });
      window.appUI.toast("Account report submitted for moderator review.",{tone:"success"});
    } catch(error) {
      window.appUI.toast(error.message||"Could not submit report.",{tone:"error"});
    } finally{reportUserBtn.disabled=false;}
  });
  actions.append(reportUserBtn);
  const allowRequests = state.profile?.allow_requests !== false;
  const allowMessages = state.profile?.allow_messages !== false;

  if (state.friendship?.status === "blocked") {
    if (state.friendship.blocked_by === state.user.id) {
      const unblock = document.createElement("button");
      unblock.className = "btn ghost";
      unblock.textContent = "Unblock";
      unblock.addEventListener("click", unblockUser);
      actions.appendChild(unblock);
    } else {
      const blocked = document.createElement("span");
      blocked.className = "chip";
      blocked.textContent = "You are blocked";
      actions.appendChild(blocked);
    }
    return;
  }

  const creatorFollow=document.createElement("button");
  creatorFollow.type="button";creatorFollow.className=state.followsCreator?"btn ghost":"btn";
  creatorFollow.textContent=state.followsCreator?"Following ✓":"Follow creator";
  creatorFollow.setAttribute("aria-pressed",String(state.followsCreator));
  creatorFollow.addEventListener("click",()=>void toggleCreatorFollow(creatorFollow));
  actions.append(creatorFollow);

  // Staff outreach is independent of friendship. Role eligibility is
  // verified by a server-owned Supabase function, never editable metadata.
  if(state.staffMessageAccess && allowMessages && state.friendship?.status!=="accepted"){
    const staffChat=document.createElement("a");
    staffChat.className="btn";
    staffChat.href="chat.html?user="+encodeURIComponent(state.viewingId);
    staffChat.textContent="Message as staff";
    staffChat.setAttribute("aria-label","Start an official staff conversation");
    actions.append(staffChat);
  }
  if (!state.friendship) {
    const addBtn = document.createElement("button");
    addBtn.className = "btn";
    addBtn.textContent = allowRequests ? "Add Friend" : "Requests closed";
    addBtn.disabled = !allowRequests;
    addBtn.addEventListener("click", sendFriendRequest);
    const blockBtn = document.createElement("button");
    blockBtn.className = "btn ghost";
    blockBtn.textContent = "Block";
    blockBtn.addEventListener("click", blockUser);
    actions.appendChild(addBtn);
    actions.appendChild(blockBtn);
    return;
  }

  if (state.friendship.status === "pending" && state.friendship.requester_id === state.user.id) {
    const sent = document.createElement("span");
    sent.className = "chip";
    sent.textContent = "Request sent";
    const cancel = document.createElement("button");
    cancel.className = "btn ghost";
    cancel.textContent = "Cancel";
    cancel.addEventListener("click", declineFriendRequest);
    const blockBtn = document.createElement("button");
    blockBtn.className = "btn ghost";
    blockBtn.textContent = "Block";
    blockBtn.addEventListener("click", blockUser);
    actions.appendChild(sent);
    actions.appendChild(cancel);
    actions.appendChild(blockBtn);
    return;
  }

  if (state.friendship.status === "pending" && state.friendship.addressee_id === state.user.id) {
    const accept = document.createElement("button");
    accept.className = "btn";
    accept.textContent = "Accept";
    accept.addEventListener("click", acceptFriendRequest);
    const decline = document.createElement("button");
    decline.className = "btn ghost";
    decline.textContent = "Decline";
    decline.addEventListener("click", declineFriendRequest);
    const blockBtn = document.createElement("button");
    blockBtn.className = "btn ghost";
    blockBtn.textContent = "Block";
    blockBtn.addEventListener("click", blockUser);
    actions.appendChild(accept);
    actions.appendChild(decline);
    actions.appendChild(blockBtn);
    return;
  }

  if (state.friendship.status === "accepted") {
    if (allowMessages) {
      const chat = document.createElement("a");
      chat.className = "btn";
      chat.href = `chat.html?user=${state.viewingId}`;
      chat.textContent = "Message";
      actions.appendChild(chat);
    } else {
      const disabled = document.createElement("span");
      disabled.className = "chip";
      disabled.textContent = "Messaging disabled";
      actions.appendChild(disabled);
    }

    const remove = document.createElement("button");
    remove.className = "btn ghost";
    remove.textContent = "Remove";
    remove.addEventListener("click", removeFriendship);
    const blockBtn = document.createElement("button");
    blockBtn.className = "btn ghost";
    blockBtn.textContent = "Block";
    blockBtn.addEventListener("click", blockUser);
    actions.appendChild(remove);
    actions.appendChild(blockBtn);
  }
}

function setupProfileEditor() {
  const editor = document.getElementById("profileEditor");
  const form = document.getElementById("profileForm");
  const status = document.getElementById("profileStatus");
  const avatarFile = document.getElementById("editAvatarFile");
  const avatarPreview = document.getElementById("editAvatarPreview");
  const coverFile = document.getElementById("editCoverFile");
  const coverPreview = document.getElementById("editCoverPreview");
  if (!editor || !form) return;
  if (!state.user || state.user.id !== state.viewingId) {
    editor.style.display = "none";
    return;
  }
  editor.style.display = "block";
  document.getElementById("editDisplayName").value = state.profile?.display_name || "";
  const usernameInput = document.getElementById("editUsername");
  if (usernameInput) {
    usernameInput.value = state.profile?.username || "";
  }
  document.getElementById("editHeadline").value = state.profile?.headline || "";
  document.getElementById("editBio").value = state.profile?.bio || "";
  document.getElementById("editLocation").value = state.profile?.location || "";
  document.getElementById("editWebsite").value = state.profile?.website || "";
  document.getElementById("editAvatarUrl").value = state.profile?.avatar_url || "";
  document.getElementById("editCoverUrl").value = state.profile?.cover_url || "";

  let avatarUploadFile = null;
  let avatarPreviewUrl = "";
  let coverUploadFile = null;
  let coverPreviewUrl = "";

  if (avatarPreview) {
    if (state.profile?.avatar_url && isSafeUrl(state.profile.avatar_url)) {
      avatarPreview.src = state.profile.avatar_url;
      avatarPreview.style.display = "block";
    } else {
      avatarPreview.style.display = "none";
    }
  }

  if (coverPreview) {
    if (state.profile?.cover_url && isSafeUrl(state.profile.cover_url)) {
      coverPreview.src = state.profile.cover_url;
      coverPreview.style.display = "block";
    } else {
      coverPreview.style.display = "none";
    }
  }

  if (avatarFile) {
    avatarFile.addEventListener("change", () => {
      const file = avatarFile.files[0];
      if (!file) {
        avatarUploadFile = null;
        if (avatarPreview) {
          avatarPreview.style.display = "none";
          avatarPreview.src = "";
        }
        return;
      }
      avatarUploadFile = file;
      if (avatarPreview) {
        if (avatarPreviewUrl) URL.revokeObjectURL(avatarPreviewUrl);
        avatarPreviewUrl = URL.createObjectURL(file);
        avatarPreview.src = avatarPreviewUrl;
        avatarPreview.style.display = "block";
      }
    });
  }

  if (coverFile) {
    coverFile.addEventListener("change", () => {
      const file = coverFile.files[0];
      if (!file) {
        coverUploadFile = null;
        if (coverPreview) {
          coverPreview.style.display = "none";
          coverPreview.src = "";
        }
        return;
      }
      coverUploadFile = file;
      if (coverPreview) {
        if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
        coverPreviewUrl = URL.createObjectURL(file);
        coverPreview.src = coverPreviewUrl;
        coverPreview.style.display = "block";
      }
    });
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if(form.dataset.saving==="true")return;
    form.dataset.saving="true";
    form.setAttribute("aria-busy","true");
    const saveButton=form.querySelector('button[type="submit"]');
    const originalLabel=saveButton?.textContent||"Save Profile";
    if(saveButton){saveButton.disabled=true;saveButton.textContent="Updating profile…";saveButton.setAttribute("aria-disabled","true");}
    if(status){status.textContent="Updating profile…";status.style.display="block";status.setAttribute("role","status");}
    try {
    const displayName = document.getElementById("editDisplayName").value.trim();
    const rawUsername = document.getElementById("editUsername")?.value.trim() || "";
    const username = sanitizeUsername(rawUsername);
    const headline = document.getElementById("editHeadline").value.trim();
    const bio = document.getElementById("editBio").value.trim();
    const location = document.getElementById("editLocation").value.trim();
    const website = document.getElementById("editWebsite").value.trim();
    const avatarUrl = document.getElementById("editAvatarUrl").value.trim();
    const coverUrl = document.getElementById("editCoverUrl").value.trim();

    if (rawUsername && !username) {
      if (status) {
        status.textContent = "Use letters, numbers, or underscores for your username.";
        status.style.display = "block";
      }
      return;
    }
    if (username && !(await isUsernameAvailable(username, state.user.id))) {
      if (status) {
        status.textContent = "Username already taken. Try another one.";
        status.style.display = "block";
      }
      return;
    }

    let uploadedAvatar = "";
    let uploadedCover = "";
    if (avatarUploadFile) {
      uploadedAvatar = await uploadMedia(avatarUploadFile, "avatars");
      if (!uploadedAvatar && status) {
        status.textContent = "Avatar upload failed. Check your media bucket and permissions.";
        status.style.display = "block";
        return;
      }
    }
    if (coverUploadFile) {
      uploadedCover = await uploadMedia(coverUploadFile, "avatars");
      if (!uploadedCover && status) {
        status.textContent = "Cover upload failed. Check your media bucket and permissions.";
        status.style.display = "block";
        return;
      }
    }

    const result = await supabase
      .from("profiles")
      .update({
        display_name: displayName,
        username,
        headline,
        bio,
        location,
        website,
        email: state.user?.email || state.profile?.email || "",
        avatar_url: uploadedAvatar || avatarUrl || state.profile?.avatar_url || "",
        cover_url: uploadedCover || coverUrl || state.profile?.cover_url || "",
        updated_at: new Date().toISOString()
      })
      .eq("id", state.user.id)
      .select()
      .single();

    if (status) {
      status.textContent = result.error ? result.error.message || "Update failed." : "Profile updated.";
      status.style.display = "block";
    }
    if (!result.error && result.data) {
      state.profile = result.data;
      renderProfile();
      renderProfileAbout();
    }
    }catch(error){
      console.error("Profile save error",error);
      if(status){status.textContent="Profile update failed. Please retry.";status.style.display="block";}
    }finally{
      form.dataset.saving="false";
      form.setAttribute("aria-busy","false");
      if(saveButton){saveButton.disabled=false;saveButton.textContent=originalLabel;saveButton.removeAttribute("aria-disabled");}
    }
  });
}

function setupPrivacyForm() {
  const form = document.getElementById("privacyForm");
  const status = document.getElementById("privacyStatus");
  if (!form || !state.profile || !state.user || state.user.id !== state.viewingId) return;
  document.getElementById("toggleMessages").checked = state.profile.allow_messages !== false;
  document.getElementById("toggleRequests").checked = state.profile.allow_requests !== false;
  document.getElementById("toggleEmail").checked = !!state.profile.show_email;
  document.getElementById("toggleMsgNotify").checked = state.profile.notify_messages !== false;
  document.getElementById("toggleReplyNotify").checked = state.profile.notify_replies !== false;
  const followToggle = document.getElementById("toggleFollowNotify");
  if (followToggle) followToggle.checked = state.profile.notify_follows !== false;
  const mentionToggle = document.getElementById("toggleMentionNotify");
  if (mentionToggle) mentionToggle.checked = state.profile.notify_mentions !== false;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const updates = {
      allow_messages: document.getElementById("toggleMessages").checked,
      allow_requests: document.getElementById("toggleRequests").checked,
      show_email: document.getElementById("toggleEmail").checked,
      notify_messages: document.getElementById("toggleMsgNotify").checked,
      notify_replies: document.getElementById("toggleReplyNotify").checked,
      notify_follows: document.getElementById("toggleFollowNotify")?.checked ?? true,
      notify_mentions: document.getElementById("toggleMentionNotify")?.checked ?? true,
      updated_at: new Date().toISOString()
    };
    const result = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", state.user.id)
      .select()
      .single();
    if (status) {
      status.textContent = result.error ? "Preferences update failed." : "Preferences saved.";
      status.style.display = "block";
    }
    if (!result.error && result.data) {
      state.profile = result.data;
      renderProfileActions();
      renderProfileAbout();
    }
  });
}

function setupSecurityForm() {
  const form = document.getElementById("securityForm");
  const status = document.getElementById("securityStatus");
  if (!form || !state.user || state.user.id !== state.viewingId) return;
  const emailInput = document.getElementById("securityEmail");
  if (emailInput) emailInput.value = state.user.email || "";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const newEmail = document.getElementById("securityNewEmail").value.trim();
    const password = document.getElementById("securityPassword").value.trim();
    const confirm = document.getElementById("securityPasswordConfirm").value.trim();

    if (!newEmail && !password) {
      if (status) {
        status.textContent = "Enter a new email or password.";
        status.style.display = "block";
      }
      return;
    }

    if (password && password !== confirm) {
      if (status) {
        status.textContent = "Passwords do not match.";
        status.style.display = "block";
      }
      return;
    }

    const updates = {};
    if (newEmail) updates.email = newEmail;
    if (password) updates.password = password;

    const result = await supabase.auth.updateUser(updates);
    if (status) {
      status.textContent = result.error
        ? result.error.message || "Security update failed."
        : "Security updated. Check your email if confirmation is required.";
      status.style.display = "block";
    }
    if (!result.error) {
      document.getElementById("securityPassword").value = "";
      document.getElementById("securityPasswordConfirm").value = "";
      if (newEmail) {
        document.getElementById("securityNewEmail").value = "";
        await supabase
          .from("profiles")
          .update({ email: newEmail, updated_at: new Date().toISOString() })
          .eq("id", state.user.id);
      }
    }
  });
}

function setupNotificationActions() {
  const btn = document.getElementById("markAllReadBtn");
  if (!btn || !state.user || state.viewingId !== state.user.id) return;
  btn.addEventListener("click", async () => {
    await markAllNotificationsRead(state.user.id);
    await loadNotifications();
    renderNotifications();
  });
}

async function loadActivity() {
  const [topicsRes, commentsRes, sharesRes] = await Promise.all([
    supabase.from("discussion_topics").select("id, title, description, created_at").eq("author_id", state.viewingId).order("created_at", { ascending: false }),
    supabase.from("comments").select("id, post_id, body, created_at").eq("author_id", state.viewingId).order("created_at", { ascending: false }),
    supabase.from("post_shares").select("id, post_id, channel, created_at").eq("user_id", state.viewingId).order("created_at", { ascending: false })
  ]);

  state.activity.topics = topicsRes.data || [];
  state.activity.comments = commentsRes.data || [];
  state.activity.shares = sharesRes.data || [];

  const postIds = new Set();
  state.activity.comments.forEach((comment) => postIds.add(comment.post_id));
  state.activity.shares.forEach((share) => postIds.add(share.post_id));

  if (postIds.size) {
    const postsRes = await supabase
      .from("posts")
      .select("id, title")
      .in("id", Array.from(postIds));
    const postMap = {};
    (postsRes.data || []).forEach((post) => {
      postMap[post.id] = post;
    });
    state.activity.posts = postMap;
  } else {
    state.activity.posts = {};
  }
}

async function boot() {
  setupReveal();
  const settings = await fetchSettings();
  if (settings.themeId) {
    const theme = await fetchThemeById(settings.themeId);
    if (theme) applyThemeVariables(theme);
  }

  state.user = await getCurrentUserWithRole();
  renderAuthActions();

  const paramId = getQueryParam("id");
  const paramUsername = getQueryParam("username");
  if (paramId) {
    state.viewingId = paramId;
  } else if (paramUsername) {
    const usernameResult = await supabase
      .from("profiles")
      .select("id")
      .ilike("username", paramUsername)
      .maybeSingle();
    state.viewingId = usernameResult.data?.id || null;
    if (!state.viewingId) {
      const shell = document.getElementById("main-content");
      if (shell) {
        shell.innerHTML = `<div class="container"><div class="callout">No user found with username "@${escapeHTML(paramUsername)}".</div></div>`;
      }
      return;
    }
  } else {
    state.viewingId = state.user?.id || null;
  }
  if (!state.viewingId) {
    window.location.href = "login.html?next=profile.html";
    return;
  }

  if (state.user && state.viewingId === state.user.id) {
    state.profile = await ensureProfile(state.user);
  } else {
    state.profile = await loadProfile(state.viewingId);
  }

  if (!state.profile) {
    document.getElementById("profileName").textContent = "Profile not found";
    return;
  }

  await loadFriendship();
  if(state.user && state.viewingId!==state.user.id){
    const permission=await supabase.rpc("can_start_staff_dm");
    state.staffMessageAccess=permission.data===true&&!permission.error;
  }
  await loadFriendSummary();
  await loadCreatorFollows();
  await loadActivity();
  await loadBookmarks();
  await loadNotifications();
  await loadAdminRequest();
  renderProfile();
  renderProfileStats();
  if(state.user?.id && state.viewingId===state.user.id){
    void supabase.rpc("get_profile_visit_summary").then(({data,error})=>{
      if(!error&&data){
        state.visitorInsights=data;
        renderProfileStats();
        const target=document.getElementById("profileVisitorInsights");
        if(target){
          const visitors=Array.isArray(data.shared_viewers)?data.shared_viewers:[];
          target.innerHTML='<strong>Visitor insights</strong><p>'+Number(data.today||0)+
            ' today · '+Number(data.last_7_days||0)+' in 7 days</p>'+
            (visitors.length?'<p>Visitors who chose to share their identity: '+
              visitors.map(x=>escapeHTML(x.name||"Member")).join(", ")+'</p>':
              '<p>Individual visitor names remain private unless they opt in.</p>');
        }
      }
    }).catch(error=>console.warn("Visitor insights unavailable",error));
  }else if(state.user?.id){
    // Server deduplicates daily visits and protects visitors who opted out.
    void supabase.rpc("record_profile_visit",{p_profile_id:state.viewingId})
      .then(({error})=>{if(error)console.warn("Profile visit was not recorded:",error.message);})
      .catch(error=>console.warn("Profile visit unavailable",error));
  }
  renderProfileAbout();
  renderVerification();
  renderProfileFriends();
  renderActivity();
  renderBookmarks();
  if(state.user?.id===state.viewingId)mountReadingLibrary(state.user);
  renderNotifications();
  document.getElementById("profileVideoUpload").hidden = !state.user || state.user.id !== state.viewingId;
  setupProfileTabs();
  setupNotificationTabs();
  renderProfileActions();
  setupProfileEditor();
  setupPrivacyForm();
  setupSecurityForm();
  setupAdminRequestForm();
  setupNotificationActions();
}

async function loadBookmarks() {
  if (!state.user || state.viewingId !== state.user.id) return;
  state.bookmarks = await fetchBookmarks(state.user.id);
}

async function loadNotifications() {
  if (!state.user || state.viewingId !== state.user.id) return;
  state.notifications = await fetchNotifications(state.user.id);
}

async function loadAdminRequest() {
  if (!state.user || state.viewingId !== state.user.id) return;
  const result = await supabase
    .from("admin_requests")
    .select("*")
    .eq("user_id", state.user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  state.adminRequest = result.data || null;
}

function setupAdminRequestForm() {
  const form = document.getElementById("adminRequestForm");
  const status = document.getElementById("adminRequestStatus");
  if (!form || !state.user || state.viewingId !== state.user.id) return;
  const role = state.user.user_metadata?.role || "user";
  if (role !== "user") {
    form.style.display = "none";
    if (status) status.style.display = "none";
    return;
  }

  const renderStatus = () => {
    if (!status) return;
    if (!state.adminRequest) {
      status.style.display = "none";
      return;
    }
    status.style.display = "block";
    status.textContent = `Admin request status: ${state.adminRequest.status || "pending"}.`;
  };

  renderStatus();

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.adminRequest && state.adminRequest.status === "pending") {
      if (status) {
        status.textContent = "Your request is already pending review.";
        status.style.display = "block";
      }
      return;
    }
    const message = document.getElementById("adminRequestMessage").value.trim();
    const payload = {
      id: crypto.randomUUID(),
      user_id: state.user.id,
      user_email: state.user.email || "",
      user_name: state.profile?.display_name || getDisplayName(state.user),
      message,
      status: "pending",
      created_at: new Date().toISOString()
    };
    const result = await createAdminRequest(payload);
    if (status) {
      status.textContent = result.error ? "Request failed." : "Request submitted.";
      status.style.display = "block";
    }
    if (!result.error && result.data) {
      state.adminRequest = result.data;
      renderStatus();
    }
  });
}

boot().catch((error) => {
  reportAppError(error, "Profile load failed");
  const title = document.getElementById("profileName");
  if (title) title.textContent = "Error loading profile";
  const bio = document.getElementById("profileBio");
  if (bio) bio.textContent = extractErrorMessage(error, "Unable to load this profile right now.");
});
