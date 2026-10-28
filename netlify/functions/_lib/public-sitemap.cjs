"use strict";
// Canonical, crawlable *section* pages. Do not list dashboards, authenticated
// views, personal feeds (fyp.html is noindex), expired stories or admin routes.
const SITE_URL="https://blipmood.netlify.app";
const STATIC_PATHS=Object.freeze([
  "/",
  "/discussion.html",
  "/spaces.html",
  "/videos.html",
  "/novels.html",
  "/marketplace.html",
  "/stories.html",
  "/announcements.html",
  "/content-policy.html",
  "/ads.html",
  "/newsletter.html",
  "/contact.html",
  "/support.html",
  "/terms.html",
  "/privacy.html",
  "/cookies.html",
  "/accessibility.html"
]);
const validId=id=>typeof id==="string"&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id);
function escapeXml(value){
 return String(value).replace(/&/g,"&amp;").replace(/</g,"&lt;")
  .replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
}
function validLastmod(value){
 if(!value)return "";
 const date=new Date(value);
 return Number.isFinite(date.getTime())?date.toISOString().slice(0,10):"";
}
function buildSitemap(entries){
 const seen=new Set();
 const output=[];
 for(const item of entries){
  if(!item||typeof item.path!=="string"||!item.path.startsWith("/")||
     item.path.startsWith("//"))continue;
  const absolute=SITE_URL+item.path;
  if(seen.has(absolute))continue;
  seen.add(absolute);
  const lastmod=validLastmod(item.updated_at);
  output.push("  <url>\n    <loc>"+escapeXml(absolute)+"</loc>"+
   (lastmod?"\n    <lastmod>"+lastmod+"</lastmod>":"")+
   "\n  </url>");
 }
 return '<?xml version="1.0" encoding="UTF-8"?>\n'+
  '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'+
  output.join("\n")+"\n</urlset>\n";
}
const staticEntries=()=>STATIC_PATHS.map(path=>({path}));
module.exports={SITE_URL,STATIC_PATHS,validId,validLastmod,buildSitemap,staticEntries};
