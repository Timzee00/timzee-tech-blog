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
import {FX_EFFECTS,DEFAULT_FX,normalizeFx,createProfileFxEngine} from "./profile-fx.mjs";
import {syncObservedRegion} from "./observed-region.mjs";
import "./nav.js";
import { submitModerationReport } from "./moderation-reports.mjs";

const state = {
  user: null,
  profile: null,
  identityExtras: null,
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
  adminRequest: null,
  profilePosts: [], profileMedia: [], profilePostOffset: 0,
  profilePostHasMore: false, profilePostsLoaded: false, profilePostsLoading: false,
  profilePostsError: false,
  profileVideoMedia: [], profileVideoMediaLoaded: false
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
    if(!source||source.hidden||!source.getAttribute("src"))return;
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
  const avatarLink=document.getElementById("profileAvatarLink");
  if(avatarLink)avatarLink.setAttribute("aria-label","View full profile photo");
  if (cover) {
    const coverUrl=String(state.profile?.cover_url||"").trim();
    cover.hidden=!coverUrl;
    if(coverUrl)cover.src=coverUrl;else cover.removeAttribute("src");
    const button=cover.closest(".profile-cover-open");
    if(button)button.disabled=!coverUrl;
  }
  const tier=verifiedLevel(state.profile);
  const hero=document.querySelector(".profile-page .profile-hero");
  const frame=document.querySelector(".profile-page .profile-avatar-wrap");
  if(hero){
    hero.classList.remove("tz-frame","tz-frame--silver","tz-frame--gold",
      "tz-frame--platinum","tz-frame--business","tz-frame--government");
    if(tier){
      hero.dataset.verificationLevel=tier;
      hero.classList.add("tz-frame","tz-frame--"+tier);
      hero.dataset.frameStyle=verifiedFrameStyle(state.profile);
    }else {delete hero.dataset.verificationLevel;delete hero.dataset.frameStyle;}
  }
  if(frame){
    frame.classList.remove("tz-frame","tz-frame--silver","tz-frame--gold","tz-frame--platinum",
      "tz-frame--business","tz-frame--government",...FRAME_STYLES.map(style=>"tz-frame--"+style));
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
  if (role) {
    const roleName=String(state.profile?.role||"member").toLowerCase();
    role.textContent=roleName==="user"?"Member":roleName;
    role.hidden=["member","user","reader"].includes(roleName);
  }
  const ribbon=document.getElementById("profileFrameName");
  if(ribbon)ribbon.textContent=plainDisplayName(state.profile?.display_name||"Member").slice(0,22);
  const company=document.getElementById("profileIdentityExtras");
  if(company){
    const item=state.identityExtras?.organizations?.[0];
    const logo=String(item?.logo_url||"");
    const validLogo=/^https:\/\//i.test(logo)&&!/[<>"'\\]/.test(logo);
    company.innerHTML=item?'<span class="tz-account-affiliation">'+
      (validLogo?'<img src="'+escapeHTML(logo)+'" alt="" loading="lazy" decoding="async">':"⌂")+
      '<span>'+escapeHTML(item.title||"Affiliate")+' · '+escapeHTML(item.name||"Organization")+'</span></span>':"";
  }
  if (badgeWrap) {
    const badges = [];
    const earned=(state.identityExtras?.awards||[]).filter(x=>x?.code);
    const hasEarned=code=>earned.some(x=>x.code===code);
    if (state.profile?.is_featured && !hasEarned("featured")) badges.push('<span class="badge-chip featured">Featured</span>');
    if (state.profile?.is_staff_pick && !hasEarned("staff_pick")) badges.push('<span class="badge-chip staff">Staff Pick</span>');
    for(const award of earned.slice(0,4)){
      const label=IDENTITY_AWARDS[award.code];
      if(label)badges.push('<span class="badge-chip '+(award.code==="staff_pick"?"staff":"featured")+'" title="'+
        escapeHTML(award.reason||"Blipmood recognition")+'">'+escapeHTML(label)+'</span>');
    }
    for(const appointment of (state.identityExtras?.appointments||[]).slice(0,2)){
      const label=IDENTITY_ROLES[appointment.role];
      if(label)badges.push('<span class="badge-chip" title="'+escapeHTML(appointment.summary||"Official appointment")+
        '">'+escapeHTML(label)+'</span>');
    }
    badgeWrap.innerHTML = badges.join("");
  }
}


const IDENTITY_ROLES=Object.freeze({
 product_lead:"Product Lead",product_advisor:"Product Advisor",
 community_advisor:"Community Advisor",community_contributor:"Community Contributor"
});
const IDENTITY_AWARDS=Object.freeze({
 staff_pick:"Staff Pick",featured:"Featured Creator",
 platinum:"Platinum Distinction",product_contributor:"Product Contributor"
});
function identityDate(value){
 if(!value||Number.isNaN(Date.parse(value)))return "";
 return new Date(value).toLocaleDateString(undefined,{month:"long",year:"numeric",day:"numeric"});
}
function renderAccountTransparency(){
 const host=document.getElementById("profileTransparencyContent");
 if(!host||!state.profile)return;
 const details=state.identityExtras||{};
 const verified=verifiedLevel(state.profile);
 const item=(title,detail,foot="")=>'<div class="tz-transparency-item"><strong>'+escapeHTML(title)+
 '</strong><span>'+escapeHTML(detail)+'</span>'+(foot?'<small>'+escapeHTML(foot)+'</small>':"")+'</div>';
 const parts=[];
 parts.push(item("Joined Blipmood",identityDate(state.profile.created_at)||"Date unavailable"));
 const publicBadge={silver:"Blue · Verified individual",gold:"Gold · Verified creator",
   platinum:"Platinum · Distinguished verified creator",business:"Gold · Verified organization",
   government:"Grey · Verified government / public official"};
 parts.push(item("Account verification",verified
   ?(publicBadge[verified]||"Verified account")
   :"Not currently verified",verified
    ?("Verified since "+(identityDate(state.profile.verified_at)||"date unavailable")+
      ". Verification can be reviewed or withdrawn."):"Verification is available through a reviewed application."));
 if(verified==="government"){
   parts.push(item("Official designation",state.profile.official_badge_title||"Verified government / public office",
     "Requires evidence-based staff review; a political opinion alone does not qualify."));
 }
 if(verified && ["gold","platinum","government"].includes(verified)){
   const originalTier=String(state.profile.verification_tier||"silver");
   parts.push(item("Existing creator entitlements",originalTier[0].toUpperCase()+originalTier.slice(1)+" tier",
     "Your original account privileges remain distinct from this public badge."));
 }
 for(const org of (details.organizations||[]).slice(0,5)){
   parts.push(item("Verified affiliation",String(org.title||"Member")+" · "+String(org.name||"Organization"),
      "Accepted company affiliation — distinct from verification and staff authority"));
 }
 for(const role of (details.appointments||[]).slice(0,5)){
   parts.push(item(IDENTITY_ROLES[role.role]||"Community appointment",
     role.specialty||role.summary||"Blipmood-appointed role",
     "Appointed "+(identityDate(role.granted_at)||"date unavailable")));
 }
 for(const award of (details.awards||[]).slice(0,8)){
   parts.push(item(IDENTITY_AWARDS[award.code]||"Recognition",award.reason||"Community contribution",
     "Recognized "+(identityDate(award.awarded_at)||"date unavailable")));
 }
 if(state.profile.is_staff_pick && !(details.awards||[]).some(x=>x.code==="staff_pick")){
   parts.push(item("Staff Pick","Legacy staff recognition","The historical award does not have a published justification."));
 }
 if(state.profile.is_featured && !(details.awards||[]).some(x=>x.code==="featured")){
   parts.push(item("Featured","Featured by Blipmood","A discovery placement, not a verification credential."));
 }
 host.innerHTML=parts.join("")+
  (state.user?.id===state.viewingId?'<div id="profileAffiliationInvites" role="status"></div><a class="btn ghost sm" href="advisor.html">Apply to become an Advisor</a>':"")+
  (verified?"":'<a class="btn ghost sm" href="verify.html">Apply for free reviewed verification</a>');
 const transparency=document.getElementById("profileTransparency");
 if(transparency&&!transparency.dataset.identityBound){
   transparency.dataset.identityBound="true";
   transparency.addEventListener("toggle",()=>{
     if(transparency.open&&state.user?.id===state.viewingId)void loadIdentityInvitations();
   });
 }
}
async function loadIdentityInvitations(){
 const host=document.getElementById("profileAffiliationInvites");
 if(!host||!state.user||state.user.id!==state.viewingId)return;
 try{
   const {data,error}=await supabase.from("identity_affiliations")
     .select("id,organization_id,title").eq("user_id",state.user.id)
     .eq("status","pending").limit(8);
   if(error)throw error;
   if(!data?.length){host.textContent="";return;}
   const ids=[...new Set(data.map(x=>x.organization_id))];
   const orgs=await supabase.from("identity_organizations")
     .select("id,name").in("id",ids).eq("status","verified");
   if(orgs.error)throw orgs.error;
   const names=new Map((orgs.data||[]).map(x=>[x.id,x.name]));
   host.innerHTML='<h3>Pending organization invitations</h3>'+
      data.filter(x=>names.has(x.organization_id)).map(x=>
        '<div class="tz-transparency-item"><span>'+escapeHTML(names.get(x.organization_id))+
        ' · '+escapeHTML(x.title)+'</span><button type="button" class="btn ghost sm" data-accept-affiliation="'+
        escapeHTML(x.id)+'">Accept affiliation</button></div>').join("");
   host.querySelectorAll("[data-accept-affiliation]").forEach(button=>
     button.addEventListener("click",async()=>{
       button.disabled=true;
       try{
         const {error}=await supabase.rpc("accept_identity_affiliation",{p_affiliation_id:button.dataset.acceptAffiliation});
         if(error)throw error;
         await loadIdentityExtras();
         if(document.getElementById("profileTransparency")?.open)void loadIdentityInvitations();
       }catch(err){button.disabled=false;window.appUI?.toast?.(err.message||"Unable to accept affiliation.",{type:"error"});}
     }));
 }catch(error){host.textContent="Invitations are temporarily unavailable.";}
}
async function loadIdentityExtras(){
 if(!state.viewingId)return;
 try{
   const {data,error}=await supabase.rpc("blipmood_public_identity",{p_user_id:state.viewingId});
   if(error)throw error;
   state.identityExtras={
      organizations:Array.isArray(data?.organizations)?data.organizations:[],
      appointments:Array.isArray(data?.appointments)?data.appointments:[],
      awards:Array.isArray(data?.awards)?data.awards:[]
   };
   // One profile-only lookup; feeds use the indexed public author batch cache.
   const official=await supabase.from("public_profiles")
     .select("official_badge_kind,official_badge_title")
     .eq("id",state.viewingId).maybeSingle();
   if(!official.error&&official.data){
     state.profile.official_badge_kind=official.data.official_badge_kind;
     state.profile.official_badge_title=official.data.official_badge_title;
   }
   const affiliation=state.identityExtras.organizations[0];
   if(affiliation)state.profile.blipmoodOrganization=affiliation;
   else delete state.profile.blipmoodOrganization;
   renderProfile();
   renderAccountTransparency();
 }catch(error){
   // Missing optional identity data must NEVER block core profile, chat or feed.
   console.warn("Optional account transparency is unavailable:",error.message);
   renderAccountTransparency();
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
    silver:["Distinct Blue badge and blue portrait frames","Former Silver-tier creator benefits are preserved","Verified status and community identity tools"],
    gold:["Distinct Gold badge and gold portrait frames","Existing Gold-tier creator publishing benefits","Verified contributions and insights"],
    platinum:["Exclusive Platinum badge and premium purple portrait frames","Distinguished creator identity and frame collection","Original Platinum-tier perks are preserved"],
    business:["Gold organization check and branded profile frames","Official organization identity on social surfaces","Reviewed brand and organization protection"],
    government:["Official Grey verification for a government institution or public officeholder","Public office review is separate from your original creator perks","Verified identity and account transparency"]
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


let profileFxEngine=null;
let profileFxPreviewEngine=null;
async function setupProfileFx(){
 const cover=document.querySelector(".profile-page .profile-cover");
 const avatar=document.querySelector(".profile-page .profile-avatar-wrap");
 const canvas=document.getElementById("profileFxCanvas");
 if(!cover||!canvas||!state.viewingId)return;
 if(profileFxEngine)profileFxEngine.destroy();
 profileFxEngine=createProfileFxEngine({host:cover,canvas,avatar,maxParticles:62});
 let stored={...DEFAULT_FX};
 try{
  const {data,error}=await supabase.from("member_profile_effects")
    .select("cover_effect,avatar_effect,intensity,enabled")
    .eq("user_id",state.viewingId).maybeSingle();
  if(error)throw error;
  stored=normalizeFx(data||DEFAULT_FX);
 }catch(error){
  // Profile FX is optional; loading failure must never hide the user's profile.
  console.warn("Optional profile effects are unavailable:",error.message);
 }
 profileFxEngine.apply(stored);
 const own=state.user?.id===state.viewingId;
 const studio=document.getElementById("profileFxStudio");
 if(!own||!studio)return;
 studio.hidden=false;
 const coverPreview=document.getElementById("fxStudioCover");
 const avatarPreview=document.getElementById("fxStudioAvatar");
 if(coverPreview)coverPreview.src=document.getElementById("profileCoverImg")?.src||"";
 if(avatarPreview)avatarPreview.src=state.profile.avatar_url||"/assets/img/avatar-placeholder.svg";
 document.getElementById("fxStudioName").textContent=plainDisplayName(state.profile.display_name||"Member");
 document.getElementById("fxStudioHandle").textContent="@"+(state.profile.username||"member");
 if(profileFxPreviewEngine)profileFxPreviewEngine.destroy();
 profileFxPreviewEngine=createProfileFxEngine({
   host:document.getElementById("fxStudioPreview"),
   canvas:document.getElementById("fxStudioCanvas"),
   avatar:document.getElementById("fxStudioAvatarWrap"),maxParticles:44
 });
 let target="cover",draft={...stored},saving=false;
 const choiceList=document.getElementById("fxStudioGallery");
 const symbols={none:"○",storm:"ϟ",inferno:"♨",glitch:"▦",frost:"❄",void:"◉",
   sakura:"❀",aurora:"〰",stardust:"✧",hearts:"♥",fireflies:"◌",
   neon:"◎",halo:"◌",eclipse:"☾",diamond:"◇"};
 const status=document.getElementById("fxStudioStatus");
 const intensity=document.getElementById("fxIntensity");
 const enabled=document.getElementById("fxEnabled");
 const getChoice=()=>draft[target+"_effect"];
 function feedback(message){if(status)status.textContent=message;}
 function repaint(){
  intensity.value=String(draft.intensity);
  document.getElementById("fxIntensityValue").textContent=draft.intensity+"%";
  enabled.checked=draft.enabled;
  profileFxPreviewEngine.apply(draft);
  for(const btn of choiceList.querySelectorAll("[data-fx-choice]")){
    btn.setAttribute("aria-pressed",String(btn.dataset.fxChoice===getChoice()));
  }
  const equal=JSON.stringify(draft)===JSON.stringify(stored);
  document.getElementById("fxSave").disabled=saving||equal;
  document.getElementById("fxRestore").disabled=saving||equal;
  document.getElementById("fxReset").disabled=saving;
 }
 function showGallery(){
  choiceList.replaceChildren();
  for(const option of FX_EFFECTS){
   const button=document.createElement("button");
   button.type="button";
   button.dataset.fxChoice=option.id;
   button.style.setProperty("--fx-chip",option.color);
   button.title=option.description;
   button.setAttribute("aria-label",option.title+": "+option.description);
   const icon=document.createElement("span");
   icon.className="fx-chip-symbol";icon.textContent=symbols[option.id]||"✧";
   icon.setAttribute("aria-hidden","true");
   const label=document.createElement("span");label.textContent=option.title;
   button.append(icon,label);choiceList.append(button);
  }
  repaint();
 }
 document.querySelectorAll("[data-fx-target]").forEach(button=>
  button.addEventListener("click",()=>{
   target=button.dataset.fxTarget==="avatar"?"avatar":"cover";
   document.querySelectorAll("[data-fx-target]").forEach(item=>item.setAttribute("aria-pressed",String(item===button)));
   repaint();
   feedback("Previewing "+target+" effects. Your saved profile is unchanged.");
  })
 );
 choiceList.addEventListener("click",event=>{
  const button=event.target.closest("[data-fx-choice]");
  if(saving||!button||!FX_EFFECTS.some(e=>e.id===button.dataset.fxChoice))return;
  draft[target+"_effect"]=button.dataset.fxChoice;
  repaint();feedback("Preview only. Select Apply effects to save.");
 });
 intensity.addEventListener("input",()=>{draft.intensity=Math.max(0,Math.min(100,Number(intensity.value)||0));repaint();});
 enabled.addEventListener("change",()=>{draft.enabled=enabled.checked;repaint();});
 document.getElementById("fxRestore").addEventListener("click",()=>{
  if(saving)return;draft={...stored};repaint();feedback("Restored your saved effect settings.");
 });
 document.getElementById("fxReset").addEventListener("click",()=>{
  if(saving)return;draft={...DEFAULT_FX};repaint();feedback("No-effects preview. Apply to save this choice.");
 });
 document.getElementById("fxSave").addEventListener("click",async()=>{
  if(saving||!state.user||state.user.id!==state.viewingId)return;
  saving=true;repaint();feedback("Saving your effects securely…");
  try{
   const submitted=normalizeFx(draft);
   await syncObservedRegion(supabase);
   const {data,error}=await supabase.from("member_profile_effects")
     .upsert({user_id:state.user.id,...submitted,updated_at:new Date().toISOString()},{onConflict:"user_id"})
     .select("cover_effect,avatar_effect,intensity,enabled").single();
   if(error)throw error;
   stored=normalizeFx(data);draft={...stored};
   profileFxEngine.apply(stored);
   feedback("Effects applied. Your cover photo and avatar are unchanged.");
  }catch(error){
   feedback(extractErrorMessage(error,"Couldn't save effects. Your previous appearance is unchanged."));
  }finally{saving=false;repaint();}
 });
 window.addEventListener("pagehide",()=>{
  profileFxEngine?.destroy();
  profileFxPreviewEngine?.destroy();
 },{once:true});
 showGallery();
 feedback("Choose a cover or avatar effect and preview it before saving.");
 const actions=document.getElementById("profileActions");
 if(actions&&!actions.querySelector(".profile-fx-cta")){
  const link=document.createElement("a");
  link.className="profile-fx-cta";
  link.href="profile.html?tab=settings#profileFxStudio";
  link.textContent="✧ Customize profile effects";
  actions.append(link);
 }
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
  renderProfileHighlights();
  const info=document.getElementById("profileReputationHelp");
  if(info)info.textContent="How reputation grows: publish a discussion topic (+5), reply in a discussion (+1), comment on an article (+2), share/copy an article link (+1), or publish an article (+10, where authorized). These are current activity rewards, not an automatic path to verified status. Levels: Starter 0–99, Rising 100–299, Pro 300–699, Legend 700+.";
}


const PROFILE_POST_PAGE=18;
function formatProfileCount(value){
 const n=Number(value);return Number.isFinite(n)&&n>=0?n.toLocaleString():"—";
}
function profilePostUrl(id){return "discussion.html?thread="+encodeURIComponent(id);}
function renderProfileHighlights(){
 const host=document.getElementById("profileSpotlightStats");if(!host)return;
 host.replaceChildren();
 const count=state.profilePostsLoaded&&!state.profilePostsError
   ?formatProfileCount(state.profilePosts.length)+(state.profilePostHasMore?"+":""):"—";
 for(const [label,value] of [["Posts",count],["Followers",formatProfileCount(state.followersCount)],
   ["Following",formatProfileCount(state.followingCount)]]){
  const cell=document.createElement("div"),valueNode=document.createElement("strong"),labelNode=document.createElement("span");
  valueNode.textContent=value;labelNode.textContent=label;cell.append(valueNode,labelNode);host.append(cell);
 }
}
function profileMediaTile(attachment,forGallery=false){
 const url=String(attachment.media_url||"");
 if(!url||url.startsWith("forum-private-media/")||!isSafeUrl(url))return null;
 const video=attachment.media_type==="video"||/\.(mp4|webm)(?:\?|$)/i.test(url);
 const node=document.createElement(forGallery?"a":"div");
 node.className=forGallery?"profile-media-item":"profile-post-thumb";
 if(video){
  const icon=document.createElement("span");
  icon.className=forGallery?"profile-media-play":"profile-video-attachment";
  icon.textContent="▶ Video";node.append(icon);
 }else{
  const img=document.createElement("img");img.src=url;
  img.alt=forGallery?"Community photo":"Photo attached to this post";
  img.loading="lazy";img.decoding="async";node.append(img);
 }
 return node;
}
function renderProfilePostFeed(){
 const host=document.getElementById("profilePostFeed"),more=document.getElementById("profileMorePosts");
 if(!host)return;
 host.replaceChildren();host.setAttribute("aria-busy",String(state.profilePostsLoading&&!state.profilePostsLoaded));
 if(state.profilePostsError&&!state.profilePosts.length){
  const note=document.createElement("p");note.className="profile-empty-state";
  note.textContent="Posts are temporarily unavailable. Please try again later.";host.append(note);
 }else if(!state.profilePostsLoaded||!state.profilePosts.length){
  const note=document.createElement("p");note.className="profile-empty-state";
  note.textContent=state.profilePostsLoaded?"No published community posts yet.":"Loading posts…";host.append(note);
 }
 for(const post of state.profilePosts){
  const article=document.createElement("article");article.className="profile-post-item";
  const meta=document.createElement("div");meta.className="profile-post-topline";
  const kind=document.createElement("span");kind.className="profile-post-kind";
  kind.textContent=String(post.kind||"discussion").replace(/^./,c=>c.toUpperCase());
  const time=document.createElement("time");time.dateTime=post.created_at||"";
  time.textContent=post.created_at?timeAgo(post.created_at):"";
  meta.append(kind,time);
  const title=document.createElement("a");title.className="profile-post-title";
  title.href=profilePostUrl(post.id);title.textContent=post.title||"Community discussion";
  article.append(meta,title);
  const excerpt=clampText(stripHTML(String(post.body||"")).replace(/\s+/g," ").trim(),240);
  if(excerpt){const p=document.createElement("p");p.className="profile-post-excerpt";p.textContent=excerpt;article.append(p);}
  const thumb=profileMediaTile(post);if(thumb)article.append(thumb);
  const foot=document.createElement("div");foot.className="profile-post-footer";
  const comments=document.createElement("span");comments.textContent=formatProfileCount(post.reply_count)+" replies";
  const votes=document.createElement("span");const score=Number(post.score);votes.textContent=(Number.isFinite(score)?score.toLocaleString():"—")+" score";
  const link=document.createElement("a");link.href=profilePostUrl(post.id);link.textContent="View discussion";
  foot.append(comments,votes,link);article.append(foot);host.append(article);
 }
 if(more){more.hidden=!state.profilePostHasMore;more.disabled=state.profilePostsLoading;}
}
function renderProfileMedia(){
 const host=document.getElementById("profileMediaGallery"),more=document.getElementById("profileMoreMedia");
 if(!host)return;
 host.replaceChildren();host.setAttribute("aria-busy",String(state.profilePostsLoading&&!state.profilePostsLoaded));
 if(!state.profilePostsLoaded||!state.profileVideoMediaLoaded||(!state.profileMedia.length&&!state.profileVideoMedia.length)){
  const p=document.createElement("p");p.className="profile-empty-state";
  p.textContent=state.profilePostsLoaded&&state.profileVideoMediaLoaded
   ?"No public photos or videos found for this creator.":"Loading media…";
  host.append(p);
 }
 for(const asset of state.profileMedia){
  const card=profileMediaTile(asset,true);if(!card)continue;
  card.href=profilePostUrl(asset.thread_id);
  card.setAttribute("aria-label","Open community post containing "+(asset.media_type==="video"?"video":"photo"));
  if(asset.media_type!=="video"){
   const badge=document.createElement("span");badge.className="profile-media-badge";badge.textContent="Photo";card.append(badge);
  }
  host.append(card);
 }
 // The unified Media view also shows this creator's public video uploads.
 for(const video of state.profileVideoMedia){
  const link=document.createElement("a");link.className="profile-media-item";
  link.href="video.html?id="+encodeURIComponent(video.id);
  link.setAttribute("aria-label","Watch "+String(video.title||"creator video"));
  if(video.thumbnail_url&&isSafeUrl(video.thumbnail_url)){
   const img=document.createElement("img");img.src=video.thumbnail_url;
   img.alt="";img.loading="lazy";img.decoding="async";link.append(img);
  }else{
   const mark=document.createElement("span");mark.className="profile-media-play";
   mark.textContent="▶ Watch video";link.append(mark);
  }
  const badge=document.createElement("span");badge.className="profile-media-badge";
  badge.textContent="▶ Video";link.append(badge);host.append(link);
 }
 if(more){more.hidden=!state.profilePostHasMore;more.disabled=state.profilePostsLoading;}
}
async function loadProfileVideoMedia(){
 if(!state.viewingId)return;
 try{
  const {data,error}=await supabase.from("videos")
   .select("id,title,thumbnail_url,created_at")
   .eq("user_id",state.viewingId).eq("is_public",true)
   .order("created_at",{ascending:false}).limit(12);
  if(error)throw error;
  state.profileVideoMedia=data||[];
 }catch(error){console.warn("Creator media videos unavailable:",error);}
 finally{state.profileVideoMediaLoaded=true;renderProfileMedia();}
}
async function loadProfilePosts({append=false}={}){
 if(state.profilePostsLoading||!state.viewingId)return;
 state.profilePostsLoading=true;
 const offset=append?state.profilePostOffset:0;
 if(!append){state.profilePosts=[];state.profileMedia=[];state.profilePostOffset=0;state.profilePostsLoaded=false;}
 state.profilePostsError=false;renderProfilePostFeed();renderProfileMedia();
 try{
  // Respect RLS for public, restricted and private community visibility.
  // At most 19 threads are fetched per page; never scan entire post history.
  const {data,error}=await supabase.from("community_threads")
   .select("id,title,body,kind,created_at,media_url,media_type,reply_count,score")
   .eq("author_id",state.viewingId).eq("status","published").eq("is_legacy_room",false)
   .order("created_at",{ascending:false}).order("id",{ascending:false})
   .range(offset,offset+PROFILE_POST_PAGE);
  if(error)throw error;
  const page=(data||[]).slice(0,PROFILE_POST_PAGE);
  const gallery=[];
  if(page.length){
   try{
    const {data:extras,error:galleryError}=await supabase.from("community_thread_media")
     .select("thread_id,media_url,media_type,position")
     .in("thread_id",page.map(p=>p.id)).order("position",{ascending:true}).limit(108);
    if(galleryError)throw galleryError;
    gallery.push(...(extras||[]));
   }catch(error){console.warn("Extra profile attachments unavailable:",error);}
  }
  const mediaSeen=new Set(state.profileMedia.map(m=>m.thread_id+"|"+m.media_url));
  for(const post of page){
   const assets=[{thread_id:post.id,media_url:post.media_url,media_type:post.media_type},
    ...gallery.filter(m=>m.thread_id===post.id)];
   for(const asset of assets){
    if(!asset.media_url||String(asset.media_url).startsWith("forum-private-media/")||!isSafeUrl(asset.media_url))continue;
    const key=asset.thread_id+"|"+asset.media_url;
    if(!mediaSeen.has(key)){state.profileMedia.push(asset);mediaSeen.add(key);}
   }
  }
  state.profilePosts.push(...page);
  state.profilePostOffset=offset+page.length;
  state.profilePostHasMore=(data||[]).length>PROFILE_POST_PAGE;
  state.profilePostsLoaded=true;
 }catch(error){
  console.warn("Profile posts unavailable:",error);
  state.profilePostsError=true;state.profilePostsLoaded=true;state.profilePostHasMore=false;
 }finally{
  state.profilePostsLoading=false;renderProfilePostFeed();renderProfileMedia();renderProfileHighlights();
 }
}
document.getElementById("profileMorePosts")?.addEventListener("click",()=>void loadProfilePosts({append:true}));
document.getElementById("profileMoreMedia")?.addEventListener("click",()=>void loadProfilePosts({append:true}));

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

let disposeProfileActionMenu=()=>{};
function attachProfileFloatingMenu(details,trigger,menu){
  // Render outside the clipped profile cover / frame stacking contexts.
  menu.hidden=true;
  menu.classList.add("profile-action-floating-menu");
  menu.setAttribute("role","group");
  menu.setAttribute("aria-label","More account actions");
  document.body.appendChild(menu);
  const place=()=>{
    if(!details.open || menu.hidden)return;
    const anchor=trigger.getBoundingClientRect();
    const width=Math.min(260,Math.max(176,window.innerWidth-24));
    menu.style.width=width+"px";
    const left=Math.max(12,Math.min(anchor.left,window.innerWidth-width-12));
    menu.style.left=left+"px";
    const height=menu.offsetHeight;
    const above=anchor.bottom+height+10>window.innerHeight-12 && anchor.top>height+16;
    menu.style.top=(above?anchor.top-height-8:Math.max(12,Math.min(anchor.bottom+8,window.innerHeight-height-12)))+"px";
  };
  const onToggle=()=>{
    menu.hidden=!details.open;
    trigger.setAttribute("aria-expanded",String(details.open));
    if(details.open)requestAnimationFrame(place);
  };
  const onOutside=event=>{
    if(details.open&&!details.contains(event.target)&&!menu.contains(event.target))details.open=false;
  };
  const onEscape=event=>{if(event.key==="Escape"&&details.open){details.open=false;trigger.focus();}};
  details.addEventListener("toggle",onToggle);
  document.addEventListener("pointerdown",onOutside,true);
  document.addEventListener("keydown",onEscape);
  window.addEventListener("scroll",place,true);
  window.addEventListener("resize",place);
  disposeProfileActionMenu=()=>{
    details.removeEventListener("toggle",onToggle);
    document.removeEventListener("pointerdown",onOutside,true);
    document.removeEventListener("keydown",onEscape);
    window.removeEventListener("scroll",place,true);
    window.removeEventListener("resize",place);
    menu.remove();
  };
}

function renderProfileActions() {
  const actions = document.getElementById("profileActions");
  if (!actions) return;
  disposeProfileActionMenu();
  disposeProfileActionMenu=()=>{};
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
  const more=document.createElement("details");
  more.className="profile-action-more";
  const summary=document.createElement("summary");
  summary.textContent="···";
  summary.setAttribute("aria-label","More account actions");
  const moreMenu=document.createElement("div");
  moreMenu.className="profile-action-more-menu";
  more.append(summary);
  moreMenu.append(reportUserBtn);
  actions.append(more);
  attachProfileFloatingMenu(more,summary,moreMenu);
  const allowRequests = state.profile?.allow_requests !== false;
  const allowMessages = state.profile?.allow_messages !== false;

  if (state.friendship?.status === "blocked") {
    if (state.friendship.blocked_by === state.user.id) {
      const unblock = document.createElement("button");
      unblock.className = "btn ghost";
      unblock.textContent = "Unblock";
      unblock.addEventListener("click", unblockUser);
      moreMenu.appendChild(unblock);
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
    moreMenu.appendChild(blockBtn);
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
    moreMenu.appendChild(blockBtn);
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
    moreMenu.appendChild(blockBtn);
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
    moreMenu.appendChild(blockBtn);
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

  // Paint identity, real cover and verified frame before optional social/activity requests.
  renderProfile();
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
  renderAccountTransparency();
  void loadIdentityExtras();
  renderProfileFriends();
  renderActivity();
  renderBookmarks();
  if(state.user?.id===state.viewingId)mountReadingLibrary(state.user);
  renderNotifications();
  document.getElementById("profileVideoUpload").hidden = !state.user || state.user.id !== state.viewingId;
  setupProfileTabs();
  void loadProfilePosts();
  void loadProfileVideoMedia();
  void setupProfileFx();
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
