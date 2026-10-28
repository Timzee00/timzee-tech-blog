/* Timzee identity system. One canonical renderer across profiles, cards,
   comments, communities and short-video feeds. No copied third-party marks.
   Display must reflect server-protected public_profiles, never self-claimed metadata. */
const LABELS=Object.freeze({
  silver:"Silver Verified",gold:"Gold Verified",
  platinum:"Platinum Verified",business:"Official Organization"
});
/* Display metadata is centralized so profile selectors, galleries, comments
   and future mobile clients all use the same server-approved frame names. */
export const FRAME_OPTIONS=Object.freeze([
  Object.freeze({id:"signature",title:"Signature",description:"A timeless metallic halo"}),
  Object.freeze({id:"library",title:"Royal Library",description:"Fine-cut ornamental rays"}),
  Object.freeze({id:"aurora",title:"Aurora",description:"Soft illuminated ribbons"}),
  Object.freeze({id:"orbit",title:"Orbit",description:"Twin orbital rings and stars"}),
  Object.freeze({id:"laurel",title:"Laurel",description:"A distinguished collector's wreath"}),
  Object.freeze({id:"comet",title:"Comet",description:"A luminous passing streak"})
]);
export const FRAME_STYLES=Object.freeze(FRAME_OPTIONS.map(item=>item.id));
const LEGACY_LEVELS=Object.freeze({standard:"silver",pro:"gold",elite:"platinum",creator:"silver"});
const ICON_ROOT="/assets/img/timzee-verified-";
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
  const tier=verifiedLevel(profile);
  return '<span class="tz-identity-name'+(tier?' tz-nameplate tz-nameplate--'+tier:'')+'">'+
    safeText(name||"Member")+verificationBadge(profile,{compact})+'</span>';
}
export function verifiedCommentClass(profile){
  const level=verifiedLevel(profile);
  return level?"tz-verified-contribution tz-verified-contribution--"+level:"";
}
export function verifiedAvatar(url,profile,{size="md",alt="Profile picture"}={}){
  const allowed=new Set(["sm","md","lg","xl"]);
  const sizeClass=allowed.has(size)?size:"md";
  // Only URLs from public_profiles should ever reach this renderer.
  const value=String(url||"");
  const safeUrl=/^(https:\/\/|\/assets\/|assets\/)/i.test(value)&&
    !/[<>"'\\]/.test(value)?value:"/assets/img/avatar-placeholder.svg";
  return '<span class="tz-avatar-verified '+verifiedFrameClasses(profile)+
    ' tz-avatar-verified--'+sizeClass+'"><img src="'+safeText(safeUrl)+
    '" alt="'+safeText(alt)+'" loading="lazy" decoding="async"></span>';
}

/** Bounded, batched public identity lookup. No N+1 requests per comment.
 *  Only public_profiles is queried: private IDs and verification documents
 *  never enter the client. Cache entries expire after 60 seconds so revoked
 *  badges do not remain visible for an entire long browsing session. */
export async function loadVerifiedIdentityMap(supabase,ids,cache=new Map()){
  const unique=[...new Set((ids||[]).filter(v=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(String(v))))].slice(0,160);
  const now=Date.now();
  // Bound memory even if someone browses thousands of different profiles.
  // Also purge expired entries so revocations eventually reach every view.
  if(cache.size>480){
    for(const [id,entry] of cache){
      if(entry?.expiresAt<=now||cache.size>320)cache.delete(id);
    }
  }
  // Treat malformed/expired entries as misses. Use <= to avoid retaining
  // a revoked badge at the exact TTL boundary.
  const missing=unique.filter(id=>{
    const entry=cache.get(id);
    return !entry||!Number.isFinite(entry.expiresAt)||entry.expiresAt<=now;
  });
  for(let start=0;start<missing.length;start+=80){
    const batch=missing.slice(start,start+80);
    const {data,error}=await supabase.from("public_profiles")
      .select("id,username,display_name,avatar_url,is_verified,verification_tier,verification_expires_at,frame_style")
      .in("id",batch);
    if(error)throw error;
    const found=new Map((data||[]).map(profile=>[profile.id,profile]));
    for(const id of batch)cache.set(id,{profile:found.get(id)||null,expiresAt:now+60000});
  }
  return new Map(unique.map(id=>[id,cache.get(id)?.profile||null]));
}

/** A public byline must never fall back to an email address even if an old
 *  video/comment row saved one before users changed their privacy settings. */
export function publicIdentityName(profile,legacyName="Member"){
 const preferred=String(profile?.username||profile?.display_name||"").trim();
 const fallback=String(legacyName||"").trim();
 const chosen=preferred||fallback;
 return chosen&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(chosen)?chosen.slice(0,70):"Member";
}
