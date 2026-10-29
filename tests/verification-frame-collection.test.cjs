const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const vm=require("node:vm");
const read=p=>readFileSync(p,"utf8");
const identitySource=read("assets/js/verified-identity.mjs").replace(/^export\s+/gm,"");
const context={};
vm.runInNewContext(identitySource+"\nthis.identity={FRAME_OPTIONS,FRAME_STYLES,verifiedLevel,verifiedFrameStyle,verifiedFrameClasses,verifiedAvatar,verifiedName,verificationBadge};",context);
const I=context.identity;
const legacyStyles=["signature","library","aurora","orbit","laurel","comet"];
const styles=[...legacyStyles,"constellation","crest","nameplate"];
const serverProfile={is_verified:true,verification_tier:"gold",frame_style:"orbit",avatar_url:"/assets/img/avatar-placeholder.svg"};

test("all nine verified collectibles use one shared frame catalog",()=>{
 assert.deepEqual(Array.from(I.FRAME_STYLES),styles);
 assert.deepEqual(Array.from(I.FRAME_OPTIONS,x=>x.id),styles);
 assert.equal(new Set(I.FRAME_STYLES).size,9);
});

test("unverified, expired and untrusted profile data cannot create a badge",()=>{
 assert.equal(I.verifiedLevel({...serverProfile,is_verified:false}),null);
 assert.equal(I.verificationBadge({...serverProfile,is_verified:false}),"");
 assert.equal(I.verifiedLevel({...serverProfile,verification_expires_at:"2000-01-01T00:00:00Z"}),null);
 assert.equal(I.verifiedLevel({...serverProfile,verification_tier:"super"}),null);
 assert.equal(I.verifiedLevel(serverProfile),"gold");
 assert.match(I.verificationBadge(serverProfile),/blipmood-verified-blue\.svg/);
});

test("avatar decoration is tier-locked and external user text never becomes markup",()=>{
 const markup=I.verifiedAvatar("javascript:alert(1)",serverProfile,{size:"lg",alt:'<img onerror="bad">'}); 
 assert.match(markup,/tz-frame--gold/);
 assert.match(markup,/tz-frame--orbit/);
 assert.match(markup,/\/assets\/img\/avatar-placeholder\.svg/);
 assert.doesNotMatch(markup,/javascript:|<img onerror/i);
 assert.match(markup,/&lt;img onerror=/);
 const safe=I.verifiedName('<svg onload="bad">',serverProfile);
 assert.doesNotMatch(safe,/<svg/i);
 assert.match(safe,/Blue Verified Individual/);
});

test("profile editor previews before saving and has an explicit restore action",()=>{
 const src=read("assets/js/profile.js");
 assert.match(src,/FRAME_OPTIONS\.map/);
 assert.match(src,/profileFrameGallery/);
 assert.match(src,/aria-pressed/);
 assert.match(src,/cancelProfileFrame/);
 assert.match(src,/profiles"\)\.update\(\{frame_style:submittedFrame\}\)/);
 assert.match(src,/\.eq\("id",state\.user\.id\)/);
 assert.match(src,/result\.data\?\.frame_style/);
});

test("server validates the collectible collection; cosmetics never grant verification",()=>{
 const sql=read("supabase/migrations/20261018140000_verified_frame_collection.sql");
 for(const name of legacyStyles)assert.ok(sql.includes("'"+name+"'"));
 assert.match(sql,/IF NOT coalesce\(NEW\.is_verified,false\) THEN/);
 assert.match(sql,/NEW\.frame_style := 'signature'/);
 assert.doesNotMatch(sql,/UPDATE\s+public\.profiles\s+SET\s+is_verified\s*=\s*true/i);
 assert.match(sql,/REVOKE EXECUTE/);
});

test("framed creator identity uses shared renderer across comment, feed and chat surfaces",()=>{
 const forum=read("assets/js/community-forum.mjs"),post=read("assets/js/post.js"),
       fyp=read("assets/js/fyp.js"),chat=read("assets/js/chat-v2.js"),html=read("chat.html");
 for(const source of [forum,post,fyp,chat])assert.match(source,/verifiedAvatar/);
 assert.match(forum,/function forumAuthor/);
 assert.match(forum,/loadVerifiedIdentityMap/);
 assert.match(post,/tz-comment-author/);
 // Hydrate into a temporary map before publishing identity decorations.
 assert.match(fyp,/identities=await loadVerifiedIdentityMap\(supabase,visible\.map/);
 assert.match(fyp,/feedIdentityMap=identities/);
 assert.match(chat,/refreshChatAvatarFrames/);
 assert.match(html,/id="chatAvatarFrame"/);
 assert.match(html,/id="infoAvatarFrame"/);
});

test("cosmetics have small screen layouts and motion-safe fallbacks",()=>{
 const css=read("assets/css/verified-identity.css");
 for(const name of styles)assert.ok(css.includes("tz-frame--"+name),"Missing CSS for "+name);
 assert.match(css,/profile-hero\[data-frame-style="orbit"\]/);
 assert.match(css,/profile-hero\[data-frame-style="laurel"\]/);
 assert.match(css,/profile-hero\[data-frame-style="comet"\]/);
 assert.match(css,/@media\(max-width:420px\)/);
 assert.match(css,/prefers-reduced-motion:reduce/);
 assert.match(css,/html\[data-reduce-motion="true"\]/);
 assert.match(css,/tz-frame-gallery/);
});

test("article comment authors retrieve the same trusted tier metadata as profiles",()=>{
 const data=read("assets/js/data.js"),post=read("assets/js/post.js");
 const start=data.indexOf("export async function fetchProfilesByIds");
 assert.ok(start>0);
 const query=data.slice(start,start+650);
 for(const field of ["is_verified","verification_tier","verification_expires_at","frame_style"]){
   assert.ok(query.includes(field),"Missing trusted field "+field);
 }
 assert.match(post,/ownProfile=\(await fetchProfilesByIds\(\[state\.user\.id\]\)\)/);
 assert.doesNotMatch(post,/comment\.image\s*\?\s*`<img src="\$\{comment\.image\}/);
 assert.match(post,/comment\.image && isSafeUrl\(comment\.image\)/);
});

test("verified identities use modest tier-specific nameplates",()=>{
 const gold=I.verifiedName("Creator",{...serverProfile,frame_style:"library"});
 assert.match(gold,/tz-nameplate--gold/);
 assert.match(gold,/tz-verified-badge--gold/);
 const anon=I.verifiedName("Reader",{...serverProfile,is_verified:false});
 assert.doesNotMatch(anon,/tz-nameplate/);
 const css=read("assets/css/verified-identity.css");
 assert.match(css,/tz-nameplate--silver/);
 assert.match(css,/tz-nameplate--gold/);
 assert.match(css,/tz-nameplate--platinum/);
 assert.match(css,/tz-nameplate--business/);
});

test("large discussion feeds use a bounded, valid-UUID identity cache",()=>{
 const helper=read("assets/js/verified-identity.mjs");
 assert.match(helper,/cache\.size>480/);
 assert.match(helper,/cache\.size>320/);
 assert.match(helper,/\[a-f0-9\]\{8\}/);
});

test("video discovery and full-screen reels use trusted tier frames and batched hydration",()=>{
 const discovery=read("videos.html"),reels=read("video.html");
 assert.match(discovery,/loadVerifiedIdentityMap\(supabase,state\.videos\.map/);
 assert.match(discovery,/tz-video-card-author/);
 assert.match(reels,/uploader_profile = p \|\| null/);
 assert.match(reels,/verifiedAvatar\(profile\?\.avatar_url,profile/);
 assert.match(reels,/loadVerifiedIdentityMap\(supabase,page\.map/);
 assert.match(reels,/verifiedCommentClass\(commentProfiles\.get/);
 assert.match(reels,/commentProfiles\.clear\(\)/);
});

test("marketplace displays verified identity without implying guaranteed purchases",()=>{
 const market=read("marketplace.html"),listing=read("listing.html");
 assert.match(market,/loadVerifiedIdentityMap\(supabase,state\.listings\.map/);
 assert.match(market,/verifiedName\(safeSellerLabel/);
 assert.doesNotMatch(market,/Verified Seller<\/span>/);
 assert.match(listing,/verifiedName\(sellerName,seller/);
 assert.match(listing,/verifiedLevel\(seller\)/);
 assert.match(listing,/does not guarantee a transaction/);
});
