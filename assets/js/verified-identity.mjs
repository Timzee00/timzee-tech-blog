/* Timzee identity system. One canonical renderer across profiles, cards,
   comments, communities and short-video feeds. No copied third-party marks.
   Display must reflect server-protected public_profiles, never self-claimed metadata. */
const LABELS=Object.freeze({
  silver:"Silver Verified",gold:"Gold Verified",
  platinum:"Platinum Verified",business:"Official Organization"
});
export const FRAME_STYLES=Object.freeze(["signature","library","aurora"]);
const LEGACY_LEVELS=Object.freeze({standard:"silver",pro:"gold",elite:"platinum",creator:"silver"});
const ICON_ROOT="assets/img/timzee-verified-";
const safeText=value=>String(value??"").replace(/[&<>"']/g,c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
})[c]);

/** Never turn an arbitrary tier value into a badge without is_verified=true. */
export function verifiedLevel(profile){
  if(profile?.is_verified!==true)return null;
  // Expired privileges cannot linger just because a background job is paused.
  if(profile?.verification_expires_at){
    const expiry=Date.parse(profile.verification_expires_at);
    if(!Number.isFinite(expiry)||expiry<=Date.now())return null;
  }
  const raw=String(profile.verification_tier||"standard").trim().toLowerCase();
  const normalized=LEGACY_LEVELS[raw]||raw;
  return Object.prototype.hasOwnProperty.call(LABELS,normalized)?normalized:null;
}
export function verifiedLabel(profile){
  const level=verifiedLevel(profile);
  return level?LABELS[level]:null;
}
export function verifiedFrameStyle(profile){
  const style=String(profile?.frame_style||"signature").trim().toLowerCase();
  return FRAME_STYLES.includes(style)?style:"signature";
}
export function verifiedFrameClasses(profile){
  const level=verifiedLevel(profile);
  return level?"tz-frame tz-frame--"+level+" tz-frame--"+verifiedFrameStyle(profile):"";
}
export function verificationBadge(profile,{compact=false}={}){
  const level=verifiedLevel(profile);
  if(!level)return "";
  const label=LABELS[level];
  return '<span class="tz-verified-badge tz-verified-badge--'+level+
    (compact?' tz-verified-badge--small':'')+
    '" role="img" aria-label="'+safeText(label)+'" title="'+safeText(label)+'">'+
    '<img src="'+ICON_ROOT+level+'.svg" alt="" width="22" height="22" loading="lazy" decoding="async">'+
    '<span class="tz-sr-only">'+safeText(label)+'</span></span>';
}
export function verifiedName(name,profile,{compact=false}={}){
  return '<span class="tz-identity-name">'+safeText(name||"Member")+
    verificationBadge(profile,{compact})+'</span>';
}
export function verifiedCommentClass(profile){
  const level=verifiedLevel(profile);
  return level?"tz-verified-contribution tz-verified-contribution--"+level:"";
}
export function verifiedAvatar(url,profile,{size="md",alt="Profile picture"}={}){
  const allowed=new Set(["sm","md","lg"]);
  const sizeClass=allowed.has(size)?size:"md";
  // Only URLs from public_profiles should ever reach this renderer.
  const value=String(url||"");
  const safeUrl=/^(https:\/\/|\/assets\/|assets\/)/i.test(value)&&
    !/[<>"'\\]/.test(value)?value:"assets/img/avatar-placeholder.svg";
  return '<span class="tz-avatar-verified '+verifiedFrameClasses(profile)+
    ' tz-avatar-verified--'+sizeClass+'"><img src="'+safeText(safeUrl)+
    '" alt="'+safeText(alt)+'" loading="lazy" decoding="async"></span>';
}

/** Bounded, batched public identity lookup. No N+1 requests per comment.
 *  Only public_profiles is queried: private IDs and verification documents
 *  never enter the client. Cache entries expire after 60 seconds so revoked
 *  badges do not remain visible for an entire long browsing session. */
export async function loadVerifiedIdentityMap(supabase,ids,cache=new Map()){
  const unique=[...new Set((ids||[]).filter(v=>/^[a-f0-9-]{36}$/i.test(String(v))))].slice(0,160);
  const now=Date.now();
  const missing=unique.filter(id=>!cache.has(id)||cache.get(id).expiresAt<now);
  for(let start=0;start<missing.length;start+=80){
    const batch=missing.slice(start,start+80);
    const {data,error}=await supabase.from("public_profiles")
      .select("id,display_name,avatar_url,is_verified,verification_tier,verification_expires_at,frame_style")
      .in("id",batch);
    if(error)throw error;
    const found=new Map((data||[]).map(profile=>[profile.id,profile]));
    for(const id of batch)cache.set(id,{profile:found.get(id)||null,expiresAt:now+60000});
  }
  return new Map(unique.map(id=>[id,cache.get(id)?.profile||null]));
}
