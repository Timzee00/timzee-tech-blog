export function isDemoFeedUrl(value) {
 try {const u=new URL(String(value||"").trim()),h=u.hostname.toLowerCase(),p=u.pathname.replace(/\/$/,"");
  return h.endsWith(".example")||["example.com","example.net","example.org"].includes(h)||
   (h==="site1.com"&&p==="/rss")||(h==="site2.com"&&p==="/feed")||(h==="site3.com"&&p==="/tips.rss");
 }catch{return false;}
}
