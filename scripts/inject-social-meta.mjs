// Build-time social cards for *section* links. Content-specific /...?id= links
// receive server-rendered OG values from the crawler-only Edge Function.
export const BRAND_IMAGE="https://blipmood.netlify.app/assets/brand/blipmood-social-card.png";
const esc=s=>String(s||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
// Only public, indexable landing pages should receive a new canonical. Do not
// force canonical links onto private screens or noindex routes such as For You.
const PUBLIC_INDEXABLE=new Set(["index.html","discussion.html","spaces.html","videos.html",
 "novels.html","marketplace.html","stories.html","announcements.html",
 "content-policy.html","ads.html","newsletter.html","contact.html",
 "support.html","terms.html","privacy.html","cookies.html","accessibility.html"]);
export function injectSocialDefaults(html,fileName,origin="https://blipmood.netlify.app"){
 if(!/<head\b[^>]*>[\s\S]*<\/head>/i.test(html)||!/<\/title>/i.test(html))return html;
 if(!/^[a-z0-9-]+\.html$/i.test(fileName))return html; // not staff/private screens
 const title=(html.match(/<title>([\s\S]*?)<\/title>/i)||[])[1]?.replace(/<[^>]+>/g,"").trim()||"Blipmood";
 const description=(html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i)||[])[1]||
   "Discover people, stories, videos and ideas on Blipmood.";
 const base=origin.replace(/\/+$/,"");
 const canonical=(html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)||[])[1]||
   base+(fileName==="index.html"?"/":"/"+fileName);
 const metas=[
  ["property","og:site_name","Blipmood"],
  ["property","og:type","website"],
  ["property","og:title",title],
  ["property","og:description",description],
  ["property","og:url",canonical],
  ["property","og:image",BRAND_IMAGE],
  ["property","og:image:alt","Blipmood — Your world. Your mood."],
  ["name","twitter:card","summary_large_image"],
  ["name","twitter:title",title],
  ["name","twitter:description",description],
  ["name","twitter:image",BRAND_IMAGE]
 ];
 let additions="";
 for(const [kind,name,value] of metas){
   const regex=new RegExp("<meta\\b[^>]*\\b"+kind+"=[\"']"+name+"[\"'][^>]*>","i");
   if(!regex.test(html))additions+="    <meta "+kind+'="'+name+'" content="'+esc(value)+'">\n';
 }
 // In the old code, the OG URL used a canonical fallback but the real
 // rel=canonical element was missing on several public pages. Google should
 // receive the same canonical URL directly in the static HTML.
 const hasCanonical=/<link\b[^>]*\brel=["']canonical["'][^>]*>/i.test(html);
 const isNoindex=/<meta\b[^>]*\bname=["']robots["'][^>]*\bcontent=["'][^"']*noindex/i.test(html);
 if(!hasCanonical&&PUBLIC_INDEXABLE.has(fileName)&&!isNoindex)
  additions+='    <link rel="canonical" href="'+esc(canonical)+'">\n';
 // The earlier static article/profile placeholders refer to unrelated stock
 // photos. Prefer the real Blipmood card until the crawler-specific lookup.
 html=html.replace(/(<meta\b[^>]*\b(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["'])https:\/\/images\.unsplash\.com\/[^"']+/gi,"$1"+BRAND_IMAGE);
 return html.replace(/<\/head>/i,additions+"</head>");
}