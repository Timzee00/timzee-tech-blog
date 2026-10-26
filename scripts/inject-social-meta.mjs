// Build-time social cards for *section* links. Content-specific /...?id= links
// receive server-rendered OG values from the crawler-only Edge Function.
export const BRAND_IMAGE="https://timzee-tech-blog.netlify.app/assets/brand/blipmood-social-card.png";
const esc=s=>String(s||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
export function injectSocialDefaults(html,fileName,origin="https://timzee-tech-blog.netlify.app"){
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
 // The earlier static article/profile placeholders refer to unrelated stock
 // photos. Prefer the real Blipmood card until the crawler-specific lookup.
 html=html.replace(/(<meta\b[^>]*\b(?:property|name)=["'](?:og:image|twitter:image)["'][^>]*content=["'])https:\/\/images\.unsplash\.com\/[^"']+/gi,"$1"+BRAND_IMAGE);
 return html.replace(/<\/head>/i,additions+"</head>");
}