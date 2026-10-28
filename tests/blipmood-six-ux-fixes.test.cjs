const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const read=p=>fs.readFileSync(p,"utf8");
const chat=read("chat.html"),chatJS=read("assets/js/chat-v2.js"),chatCSS=read("assets/css/chat-v2.css");
const listing=read("listing.html"),profile=read("assets/js/profile.js");
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
