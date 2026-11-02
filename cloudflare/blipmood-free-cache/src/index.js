/**
 * Free-plan, zero-R2 public media cache.
 * Only reads already-public Supabase media. No upload, mutation, credentials,
 * signed requests, private Chats, friends-only Stories or ephemeral statuses.
 * Cloudflare Workers Caching stores complete 200 responses and handles 206
 * ranges from the cached body automatically.
 */
const ORIGIN="https://duvbcwwprkzzyzikmcol.supabase.co/storage/v1/object/public/media/";
const ALLOWED=new Set(["videos","video-thumbnails","topics","avatars","covers","marketplace","post-media","community-threads","community-replies"]);
const MAX_VIDEO_BYTES=12*1024*1024;
const MAX_IMAGE_BYTES=4*1024*1024;
const TTL_SECONDS=90;
function response(message,status,extra={}){
 return new Response(JSON.stringify({error:message}),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store",...extra}});
}
function keyFromPath(path){
 if(!path.startsWith("/media/"))return null;
 const raw=path.slice(7);
 let key;
 try{key=decodeURIComponent(raw)}catch{return null}
 if(key.length<5||key.length>480||!/^[-\w./]+$/.test(key)||
    key.includes("..")||key.includes("//")||key.startsWith("/")||key.endsWith("/")||
    key.split("/").length<3||!/\.[a-z0-9]{2,7}$/i.test(key))return null;
 if(!ALLOWED.has(key.split("/")[0]))return null;
 return key;
}
export default {
 async fetch(request){
  const u=new URL(request.url);
  if(u.pathname==="/health"&&request.method==="GET")
   return new Response(JSON.stringify({ok:true,mode:"workers-free-cache",r2:false}),{
    status:200,headers:{"content-type":"application/json","cache-control":"no-store"}});
  if(!["GET","HEAD"].includes(request.method))return response("Method not allowed",405,{allow:"GET, HEAD"});
  if(u.search||u.hash)return response("Query strings are not permitted",400);
  const key=keyFromPath(u.pathname);
  if(!key)return response("Unknown public media path",404);
  const source=ORIGIN+key.split("/").map(encodeURIComponent).join("/");
  try{
   if(request.method==="HEAD"){
    const head=await fetch(source,{method:"HEAD",redirect:"error"});
    if(!head.ok)return response(head.status===404?"Not found":"Origin unavailable",head.status===404?404:502);
    const headers=new Headers({
     "cache-control":"no-store","x-content-type-options":"nosniff",
     "access-control-allow-origin":"*","accept-ranges":"bytes"
    });
    if(head.headers.get("content-type"))headers.set("content-type",head.headers.get("content-type"));
    if(head.headers.get("content-length"))headers.set("content-length",head.headers.get("content-length"));
    return new Response(null,{status:200,headers});
   }
   // Workers Caching strips incoming Range before this handler. Always fetch
   // the FULL origin object, return a cacheable 200 and let the CDN return 206.
   const upstream=await fetch(source,{method:"GET",redirect:"error",headers:{accept:"*/*"}});
   if(upstream.status===404)return response("Not found",404);
   if(!upstream.ok)return response("Origin unavailable",502);
   const length=Number(upstream.headers.get("content-length"));
   const type=String(upstream.headers.get("content-type")||"").split(";")[0].trim().toLowerCase();
   const video=type.startsWith("video/");
   const image=type.startsWith("image/");
   if(!video&&!image)return Response.redirect(source,307);
   const sizeLimit=video?MAX_VIDEO_BYTES:MAX_IMAGE_BYTES;
   if(!Number.isSafeInteger(length)||length<=0||length>sizeLimit){
    // Large assets may remain on Supabase; don't risk unbounded memory or
    // repeat full downloads for one-time video watches.
    upstream.body?.cancel?.().catch?.(()=>{});
    return Response.redirect(source,307);
   }
   const h=new Headers({
    "content-type":type,
    "content-length":String(length),
    "content-disposition":"inline",
    "cache-control":"public, s-maxage="+TTL_SECONDS+", max-age=0, must-revalidate",
    "access-control-allow-origin":"*",
    "access-control-expose-headers":"content-length,content-range,accept-ranges,etag",
    "accept-ranges":"bytes","x-content-type-options":"nosniff"
   });
   if(upstream.headers.get("etag"))h.set("etag",upstream.headers.get("etag"));
   return new Response(upstream.body,{status:200,headers:h});
  }catch(e){
   console.error(JSON.stringify({event:"free_media_origin_error",folder:key.split("/")[0],error:String(e?.message||"failure")}));
   return response("Media temporarily unavailable",503);
  }
 }
};
