/* Timzee identity system. One canonical renderer across profiles, cards,
   comments, communities and short-video feeds. No copied third-party marks.
   Display must reflect server-protected public_profiles, never self-claimed metadata. */
const LABELS=Object.freeze({
  silver:"Blue Verified Individual",gold:"Gold Verified Creator",
  platinum:"Platinum Verified Creator",business:"Gold Verified Organization",
  government:"Grey Verified Government / Public Official"
});
/* Display metadata is centralized so profile selectors, galleries, comments
   and future mobile clients all use the same server-approved frame names. */
export const FRAME_OPTIONS=Object.freeze([
  Object.freeze({id:"signature",title:"Signature",description:"A timeless metallic halo"}),
  Object.freeze({id:"library",title:"Royal Library",description:"Fine-cut ornamental rays"}),
  Object.freeze({id:"aurora",title:"Aurora",description:"Soft illuminated ribbons"}),
  Object.freeze({id:"orbit",title:"Orbit",description:"Twin orbital rings and stars"}),
  Object.freeze({id:"laurel",title:"Laurel",description:"A distinguished collector's wreath"}),
  Object.freeze({id:"comet",title:"Comet",description:"A luminous passing streak"}),
  Object.freeze({id:"constellation",title:"Constellation",description:"A subtle crown of stars"}),
  Object.freeze({id:"crest",title:"Heritage Crest",description:"Refined silver and teal engraving"}),
  Object.freeze({id:"nameplate",title:"Signature Name",description:"Your profile name set into a ceremonial ribbon"})
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
  if(!Object.prototype.hasOwnProperty.call(LABELS,normalized))return null;
  // Official designations are reviewed independently; premium tiers and
  // existing entitlement columns remain untouched.
  return profile.official_badge_kind==="government"?"government":normalized;
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
const safeUrl=url=>/^(https:\/\/|\/assets\/|assets\/)/i.test(String(url||""))&&!/[<>"'\\]/.test(String(url||""));
export function affiliationBadge(profile){
 const affiliation=profile?.blipmoodOrganization;
 if(!affiliation?.name)return "";
 const label="Affiliated with "+String(affiliation.name).slice(0,120);
 const logo=safeUrl(affiliation.logo_url)?'<img src="'+safeText(affiliation.logo_url)+'" alt="" width="19" height="19" loading="lazy" decoding="async">':"⌂";
 return '<span class="tz-affiliation-mark" role="button" tabindex="0" data-org-label="'+safeText(label)+
 '" data-org-title="'+safeText(affiliation.title||"Affiliated member")+'" aria-label="'+safeText(label)+
 '" title="'+safeText(label)+'">'+logo+'</span>';
}
export function verificationBadge(profile,{compact=false}={}){
 const level=verifiedLevel(profile);
 if(!level)return "";
 const label=LABELS[level];
 // Tier-specific artwork remains independent of creator feature allowances.
 // Silver legacy users receive Blue; Platinum keeps its distinct seal.
 const icon=level==="silver"?"/assets/img/blipmood-verified-blue.svg"
   :level==="government"?"/assets/img/blipmood-verified-government.svg"
   :ICON_ROOT+(level==="business"?"business":level)+".svg";
 const date=profile?.verified_at?String(profile.verified_at):"";
 return '<span class="tz-verified-badge tz-verified-badge--'+level+
   (compact?' tz-verified-badge--small':'')+
   '" role="button" tabindex="0" data-identity-label="'+safeText(label)+
   '" data-identity-date="'+safeText(date)+'" aria-label="Learn about '+safeText(label)+
   '" title="'+safeText(label)+'">'+
   '<img src="'+icon+'" alt="" width="22" height="22" loading="lazy" decoding="async">'+
   '<span class="tz-sr-only">'+safeText(label)+'</span></span>';
}
export function verifiedName(name,profile,{compact=false}={}){
 const tier=verifiedLevel(profile);
 return '<span class="tz-identity-name'+(tier?' tz-nameplate tz-nameplate--'+tier:'')+'">'+
   safeText(name||"Member")+affiliationBadge(profile)+verificationBadge(profile,{compact})+'</span>';
}
function showIdentityExplanation(element){
 if(typeof document==="undefined")return;
 let dialog=document.getElementById("tzIdentityExplanation");
 if(!dialog){
   dialog=document.createElement("dialog");
   dialog.id="tzIdentityExplanation";
   dialog.className="tz-identity-dialog";
   dialog.setAttribute("aria-labelledby","tzIdentityExplanationTitle");
   document.body.append(dialog);
   dialog.addEventListener("click",event=>{if(event.target===dialog)dialog.close();});
 }
 const isOrg=element.hasAttribute("data-org-label");
 const label=isOrg?element.dataset.orgLabel:element.dataset.identityLabel;
 const title=element.dataset.orgTitle||"";
 const rawDate=element.dataset.identityDate||"";
 const date=rawDate&&!Number.isNaN(Date.parse(rawDate))
   ?new Date(rawDate).toLocaleDateString(undefined,{year:"numeric",month:"long",day:"numeric"}):"";
 const detail=isOrg
   ?"This affiliation was approved for a verified organization and accepted by the account holder. It is separate from Blipmood identity verification."
   :label?.includes("Government")
     ?"This public official or government institution was reviewed against official evidence. Political opinions or self-described job titles alone never qualify."
   :label?.includes("Organization")
     ?"This organization has passed Blipmood's official organization review."
   :label?.includes("Platinum")
     ?"Platinum is an individually reviewed, distinguished verified tier. It does not confer moderation powers."
   :label?.includes("Gold")
     ?"Gold is an individually reviewed verified creator tier. It does not confer moderation powers."
     :"Blue marks an individually reviewed, authenticated account. Community reputation does not automatically issue verification.";
 dialog.innerHTML='<div class="tz-identity-dialog-body"><div class="tz-sheet-head"><h2 id="tzIdentityExplanationTitle">'+
   safeText(isOrg?"Organization affiliation":"Verified account")+
   '</h2><form method="dialog"><button type="submit" aria-label="Close details">✕</button></form></div>'+
   '<p class="tz-sheet-label">'+safeText(label||"Identity information")+'</p><p>'+safeText(detail)+'</p>'+
   (title?'<p><strong>Role:</strong> '+safeText(title)+'</p>':'')+
   (date?'<p><strong>Verified since:</strong> '+safeText(date)+'</p>':'')+
   '<p class="tz-sheet-footnote">Badges and affiliations can be withdrawn when requirements are no longer met.</p></div>';
 if(!dialog.open)dialog.showModal();
}
if(typeof document!=="undefined"){
 // Delegation costs one listener on a page containing hundreds of authors.
 document.addEventListener("click",event=>{
   const badge=event.target.closest?.("[data-identity-label],[data-org-label]");
   if(!badge)return;
   event.preventDefault();event.stopPropagation();showIdentityExplanation(badge);
 });
 document.addEventListener("keydown",event=>{
   if(event.key!=="Enter"&&event.key!==" ")return;
   const badge=event.target.closest?.("[data-identity-label],[data-org-label]");
   if(!badge)return;
   event.preventDefault();event.stopPropagation();showIdentityExplanation(badge);
 });
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
      .select("id,username,display_name,avatar_url,is_verified,verification_tier,verification_expires_at,verified_at,frame_style,official_badge_kind,official_badge_title,primary_org_name,primary_org_logo_url,primary_org_title")
      .in("id",batch);
    if(error)throw error;
    const found=new Map((data||[]).map(profile=>{
      if(profile.primary_org_name)profile.blipmoodOrganization={
        name:profile.primary_org_name,logo_url:profile.primary_org_logo_url,title:profile.primary_org_title
      };
      return [profile.id,profile];
    }));
    for(const id of batch)cache.set(id,{profile:found.get(id)||null,expiresAt:now+60000});
  }
  return new Map(unique.map(id=>[id,cache.get(id)?.profile||null]));
}

/** A public byline must never fall back to an email address even if an old
 *  video/comment row saved one before users changed their privacy settings. */
export function publicIdentityName(profile,legacyName="Member"){
 // Public bylines must not fall back to saved full names or old email values.
 const handle=String(profile?.username||"").trim().replace(/^@/,"");
 return /^[a-z0-9_.-]{2,70}$/i.test(handle)?handle:"Member";
}
