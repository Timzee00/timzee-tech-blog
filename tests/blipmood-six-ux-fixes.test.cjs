const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const chat=read("chat.html"),chatJS=read("assets/js/chat-v2.js"),chatCSS=read("assets/css/chat-v2.css");
const listing=read("listing.html"),marketplace=read("marketplace.html"),profile=read("assets/js/profile.js");
const video=read("video.html"),fyp=read("assets/js/fyp.js"),identities=read("assets/js/verified-identity.mjs");
const support=read("support.html"),push=read("assets/js/browser-push.mjs");
const profileHTML=read("profile.html"),pushWorker=read("netlify/functions/push-worker.js");
test("Find people floats above chat instead of being hidden below the inbox",()=>{
 assert.match(chat,/id="peopleSearchPanel" role="dialog" aria-modal="true"/);
 assert.match(chat,/id="peopleSearchClose"/);
 assert.match(chatJS,/document\.body\.append\(panel\)/);
 assert.match(chatJS,/chat-find-backdrop/);
 assert.match(chatJS,/Escape/);
 assert.match(chatCSS,/\.chat-people-search:not\(\[hidden\]\)/);
 assert.match(chatCSS,/max-height:calc\(100dvh - 158px\)/);
});
test("marketplace offers both contact channels, and inquiry no longer creates a group",()=>{
 assert.match(listing,/id="contactOnSite"/);
 assert.match(listing,/id="contactOnWhatsapp"/);
 assert.match(listing,/wa\.me\//);
 assert.match(listing,/can_send_direct_message/);
 assert.match(listing,/createMarketplaceInquiry/);
 assert.match(marketplace,/id="sellerInquiryInbox"/);
 assert.match(marketplace,/from\("marketplace_inquiries"\)/);
 assert.match(marketplace,/Contact buyer/);
 const sql=read("supabase/migrations/20261028133000_marketplace_inquiries_separate_from_chat.sql");
 assert.match(sql,/NEW\.thread_id:=NULL/);
 assert.doesNotMatch(sql,/INSERT INTO public\.chat_threads/);
});
test("profile save locks during writes and confirms completion or failure",()=>{
 assert.match(profile,/form\.dataset\.saving==="true"/);
 assert.match(profile,/form\.setAttribute\("aria-busy","true"\)/);
 assert.match(profile,/saveButton\.disabled=true/);
 assert.match(profile,/Updating profile…/);
 assert.match(profile,/Profile updated\./);
 assert.match(profile,/finally\s*\{/);
});
test("video and FYP display public names, not email-address fallbacks",()=>{
 assert.match(identities,/publicIdentityName/);
 assert.match(identities,/username,display_name,avatar_url/);
 assert.match(video,/publicIdentityName\(commentProfiles\.get\(c\.user_id\),c\.author_name\)/);
 assert.match(video,/const authorName=publicIdentityName/);
 assert.doesNotMatch(video,/state\.user\.user_metadata\?\.display_name \|\| state\.user\.email/);
 assert.match(fyp,/publicIdentityName\(profile,comment\.author_name\)/);
 const sql=read("supabase/migrations/20261028140000_video_author_email_privacy.sql");
 assert.match(sql,/privacy_safe_video_comments_author/);
 assert.match(sql,/p\.show_email IS DISTINCT FROM true/);
});
test("support routes, FAQ and form are readable and actionable",()=>{
 for(const id of ["supportForm","supportFaqSearch","faqList","supportIssue","supportStatus"])assert.ok(support.includes('id="'+id+'"'));
 assert.match(support,/support-topic-grid/);
 assert.match(support,/What do you need help with\?/);
 assert.match(support,/autocomplete="email"/);
 assert.match(support,/getPublishedFaqs/);
 assert.match(support,/\.support-request-form/);
});
test("profile push uses real Web Push subscription, not a local-only preference",()=>{
 assert.match(profileHTML,/id="deviceAlertsBtn"[^>]*data-push-managed="true"/);
 assert.match(profileHTML,/assets\/js\/browser-push\.mjs/);
 assert.match(push,/document\.getElementById\("deviceAlertsBtn"\)/);
 assert.match(push,/pushManager\.subscribe/);
 assert.match(push,/api\("POST",subscription\.toJSON\(\)\)/);
 assert.match(push,/registration\.showNotification\("Blipmood push enabled"/);
 assert.match(pushWorker,/claim_web_push_deliveries/);
 assert.match(read("netlify.toml"),/functions\."push-worker"/);
});


test("both upload pages share thumbnail extraction, validate videos, and show older covers",()=>{
 const grid=read("videos.html"),reels=read("video.html");
 const media=read("assets/js/videos-marketplace.js"),css=read("assets/css/content-pages.css");
 assert.match(media,/export function captureVideoThumbnail/);
 assert.match(media,/export function isSupportedVideoFile/);
 assert.match(media,/thumbnailFile = thumbnailFile \|\| await captureVideoThumbnail\(videoFile\)/);
 assert.match(grid,/const captureVideoFrame=captureVideoThumbnail/);
 assert.match(reels,/const captureReelCover=captureVideoThumbnail/);
 assert.match(grid,/hydrateLegacyCovers\(container\)/);
 assert.match(css,/tz-video-cover-fallback\.is-ready/);
});
test("public surfaces use account handles while profile retains full-name display",()=>{
 const grid=read("videos.html"),nav=read("assets/js/nav.js"),app=read("assets/js/app.js");
 const chat=read("assets/js/chat-v2.js"),story=read("stories.html"),article=read("assets/js/post.js");
 const forum=read("assets/js/discussion.js");
 assert.match(grid,/verifiedName\(publicIdentityName\(videoCreatorProfiles/);
 assert.doesNotMatch(grid,/verifiedName\(v\.author_name/);
 assert.match(nav,/from\("public_profiles"\)\.select\("username"\)/);
 assert.match(app,/publicHandles: new Map\(\)/);
 assert.match(chat,/profile\.username/);
 assert.match(story,/profile\?\.username \|\| profile\?\.display_name \|\| "Member"/);
 assert.match(article,/publicIdentityName\(profile\)/);
 assert.match(forum,/publicAuthorName\(message\.author_id\)/);
 assert.match(profile,/state\.profile\?\.display_name/);
});

test("push UI verifies backend ownership and offers repair instead of claiming browser-only success",()=>{
 const api=read("netlify/functions/push-subscriptions.js");
 assert.match(push,/async function isRegisteredOnServer\(subscription\)/);
 assert.match(push,/crypto\.subtle\.digest\("SHA-256"/);
 assert.match(push,/endpoint_hash=/);
 assert.match(push,/button\.dataset\.mode="repair"/);
 assert.match(push,/mode==="repair"/);
 assert.match(push,/await api\("POST",existing\.toJSON\(\)\)/);
 assert.match(push,/await api\("DELETE",subscription\.toJSON\(\)\)/);
 assert.doesNotMatch(push,/finally\{await subscription\.unsubscribe\(\)/);
 assert.match(api,/endpointHashForCheck/);
 assert.match(api,/endpointHashForCheck\)\s*return json\(200/);
 assert.match(api,/\.eq\("endpoint_hash",endpointHashForCheck\)/);
 assert.match(api,/\.eq\("user_id",userId\)/);
 assert.match(api,/subscribed:!!data/);
 assert.match(api,/if\(!token\)return json\(401/);
});

test("push server checks belong to the signed-in account and never reveal private subscriptions",async()=>{
 const vm=require("node:vm");
 const code=read("netlify/functions/push-subscriptions.js");
 const hash="a".repeat(64);
 const setup=({known=true}={})=>{
  const exports={};
  const queries=[];
  const database={
   auth:{getUser:async token=>({data:{user:{id:"user-1"}},error:null})},
   from(table){
    const conditions={};
    const q={
     select(){return q},
     eq(key,value){conditions[key]=value;return q},
     is(key,value){conditions[key]=value;return q},
     async maybeSingle(){
      queries.push({table,conditions:{...conditions}});
      if(table==="profiles")return {data:{account_status:"active"},error:null};
      if(table==="web_push_subscriptions")
       return {data:known?{id:"saved-device"}:null,error:null};
      throw Error("Unexpected table "+table);
     }
    };
    return q;
   }
  };
  vm.runInNewContext(code,{
   exports,process:{env:{
    PUSH_ENABLED:"true",PUSH_VAPID_PUBLIC_KEY:"mock-public",
    PUSH_VAPID_PRIVATE_KEY:"mock-private",BREVO_SENDER_EMAIL:"team@example.com",
    SUPABASE_URL:"https://example.supabase.co",SUPABASE_SERVICE_ROLE_KEY:"mock-service"
   }},
   require:name=>{
    if(name==="node:crypto")return {};
    if(name==="@supabase/supabase-js")return {createClient:()=>database};
    if(name==="./_lib/web-push.cjs")return {validVapidPair:()=>true};
    throw Error("Unexpected import "+name);
   }
  },{timeout:1500});
  return {handler:exports.handler,queries};
 };
 const publicState=setup();
 const publicResp=await publicState.handler({httpMethod:"GET",headers:{}});
 assert.equal(publicResp.statusCode,200);
 assert.deepEqual(JSON.parse(publicResp.body),{enabled:true,publicKey:"mock-public"});
 const anonymous=await publicState.handler({
  httpMethod:"GET",queryStringParameters:{endpoint_hash:hash},headers:{}
 });
 assert.equal(anonymous.statusCode,401);
 assert.ok(!anonymous.body.includes("saved-device"));
 const malformed=await publicState.handler({
  httpMethod:"GET",queryStringParameters:{endpoint_hash:"abc"},
  headers:{authorization:"Bearer token"}
 });
 assert.equal(malformed.statusCode,400);
 const registered=setup();
 const ok=await registered.handler({
  httpMethod:"GET",queryStringParameters:{endpoint_hash:hash},
  headers:{authorization:"Bearer token"}
 });
 assert.equal(ok.statusCode,200);
 assert.equal(JSON.parse(ok.body).subscribed,true);
 assert.ok(registered.queries.some(q=>q.table==="web_push_subscriptions"&&
  q.conditions.user_id==="user-1"&&q.conditions.endpoint_hash===hash&&
  q.conditions.disabled_at===null));
 const lost=setup({known:false});
 const missing=await lost.handler({
  httpMethod:"GET",queryStringParameters:{endpoint_hash:hash},
  headers:{authorization:"Bearer token"}
 });
 assert.equal(JSON.parse(missing.body).subscribed,false);
});
