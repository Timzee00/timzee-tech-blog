// Content-specific previews for social crawlers. Normal visitors keep the
// current static page and all its authentication/navigation behavior.
const crawler=/facebookexternalhit|facebot|meta-externalagent|twitterbot|linkedinbot|slackbot|discordbot|telegrambot|whatsapp|pinterest|googlebot|bingbot|applebot|skypeuripreview|embedly|tiktokbot|snapchat|vkshare|redditbot/i;
const keys=["id","slug","thread","community","topic","user","story"];
export default function socialPreview(request) {
 if(request.method!=="GET"&&request.method!=="HEAD")return;
 if(!crawler.test(request.headers.get("user-agent")||""))return;
 const url=new URL(request.url);
 if(!keys.some(key=>url.searchParams.has(key)))return;
 const target=new URL("/.netlify/functions/share-preview",url.origin);
 target.searchParams.set("path",url.pathname);
 for(const key of keys){
   const value=url.searchParams.get(key);
   if(value&&value.length<160)target.searchParams.set(key,value);
 }
 // Same-origin internal rewrite; crawlers still see the original share URL.
 return target;
}
export const config={
 path:["/post.html","/post","/video.html","/video","/listing.html","/listing",
 "/novel.html","/novel","/discussion.html","/discussion",
 "/profile.html","/profile","/stories.html","/stories"],
 method:["GET"],
 onError:"bypass"
};