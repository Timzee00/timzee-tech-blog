/**
 * Public-media read-through cache for Blipmood.
 * This Worker mirrors ONLY the public Supabase "media" bucket.
 * It must not be used for any Stories (even public temporary ones), private chats, or uploads.
 */
const SOURCE="https://duvbcwwprkzzyzikmcol.supabase.co/storage/v1/object/public/media/";
const FOLDERS=new Set(["videos","video-thumbnails","topics","avatars","covers","marketplace","post-media","discussion","comments","ads","community-threads","community-replies","group-avatars"]);
const MAX_COPY=24*1024*1024;
const WEEK=604800;

function json(error,status,headers={}){
 return new Response(JSON.stringify({error}),{status,headers:{"content-type":"application/json","cache-control":"no-store",...headers}});
}
function safeKey(path){
 if(!path.startsWith("/media/"))return null;
 let key;
 try{key=decodeURIComponent(path.slice(7))}catch{return null}
 if(key.length>480||!/^[-\w./]+$/.test(key)||key.includes("..")||
    key.startsWith("/")||key.includes("//")||key.includes("\\")||!FOLDERS.has(key.split("/")[0]))return null;
 if(key.split("/").length<2||!/\.[a-z0-9]{2,7}$/i.test(key))return null;
 return key;
}
function headers(type,length,etag=""){
 const h=new Headers({
  "content-type":type||"application/octet-stream",
  "cache-control":"public, max-age="+WEEK+", immutable",
  "accept-ranges":"bytes",
  "access-control-allow-origin":"*",
  "access-control-expose-headers":"content-range, content-length, etag, accept-ranges",
  "x-content-type-options":"nosniff"
 });
 if(Number.isFinite(length)&&length>=0)h.set("content-length",String(length));
 if(etag)h.set("etag",etag);
 return h;
}
function parseRange(input,size){
 if(!input)return null;
 const m=/^bytes=(\d*)-(\d*)$/.exec(input.trim());
 if(!m||(!m[1]&&!m[2]))return false;
 const a=m[1]?Number(m[1]):null;
 const b=m[2]?Number(m[2]):null;
 if((a!==null&&(!Number.isSafeInteger(a)||a>=size))||
    (b!==null&&!Number.isSafeInteger(b)))return false;
 const start=a===null?Math.max(0,size-b):a;
 const end=b===null||a===null?size-1:Math.min(size-1,b);
 return start>=0&&start<=end?{start,end}:false;
}
function partial(bytes,range,size,h){
 h.set("content-range","bytes "+range.start+"-"+range.end+"/"+size);
 h.set("content-length",String(range.end-range.start+1));
 return new Response(bytes.slice(range.start,range.end+1),{status:206,headers:h});
}
async function cached(request,env,key){
 if(request.method==="HEAD"){
  const object=await env.MEDIA_BUCKET.head(key);
  return object?new Response(null,{status:200,headers:headers(object.httpMetadata?.contentType,object.size,object.httpEtag)}):null;
 }
 const full=await env.MEDIA_BUCKET.get(key);
 if(!full)return null;
 const range=parseRange(request.headers.get("range"),full.size);
 const h=headers(full.httpMetadata?.contentType,full.size,full.httpEtag);
 if(range===false){h.set("content-range","bytes */"+full.size);h.set("content-length","0");return new Response(null,{status:416,headers:h})}
 if(range){
  const piece=await env.MEDIA_BUCKET.get(key,{range:{offset:range.start,length:range.end-range.start+1}});
  if(!piece?.body)return json("Range temporarily unavailable",503);
  h.set("content-range","bytes "+range.start+"-"+range.end+"/"+full.size);
  h.set("content-length",String(range.end-range.start+1));
  return new Response(piece.body,{status:206,headers:h});
 }
 return new Response(full.body,{status:200,headers:h});
}
async function importPublic(request,env,key){
 const url=SOURCE+key.split("/").map(encodeURIComponent).join("/");
 const upstream=await fetch(url,{method:request.method==="HEAD"?"HEAD":"GET",redirect:"error"});
 if(upstream.status===404)return json("Media not found",404);
 if(!upstream.ok)return json("Public media temporarily unavailable",502);
 const type=upstream.headers.get("content-type")||"";
 const size=Number(upstream.headers.get("content-length"));
 if(request.method==="HEAD")return new Response(null,{status:200,headers:headers(type,Number.isSafeInteger(size)?size:-1)});
 if(!/^(image|video|audio)\//i.test(type))return json("Unsupported media type",415);
 if(!Number.isSafeInteger(size)||size<1||size>MAX_COPY){
  // Preserve access to legacy media larger than the conservative cache cap.
  return Response.redirect(url,307);
 }
 const bytes=await upstream.arrayBuffer();
 if(bytes.byteLength!==size)return json("Media changed, retry",503);
 await env.MEDIA_BUCKET.put(key,bytes,{httpMetadata:{contentType:type,cacheControl:"public, max-age="+WEEK+", immutable"}});
 const h=headers(type,size);
 const range=parseRange(request.headers.get("range"),size);
 if(range===false){h.set("content-range","bytes */"+size);h.set("content-length","0");return new Response(null,{status:416,headers:h})}
 return range?partial(bytes,range,size,h):new Response(bytes,{status:200,headers:h});
}
export default {
 async fetch(request,env){
  const path=new URL(request.url);
  if(path.pathname==="/health")return new Response(JSON.stringify({ok:!!env.MEDIA_BUCKET}),{status:env.MEDIA_BUCKET?200:503,headers:{"content-type":"application/json","cache-control":"no-store"}});
  if(!["GET","HEAD"].includes(request.method))return json("Method not allowed",405,{allow:"GET, HEAD"});
  if(path.search)return json("No query parameters permitted",400);
  const key=safeKey(path.pathname);
  if(!key)return json("Invalid public media path",400);
  if(!env.MEDIA_BUCKET)return json("R2 binding unavailable",503);
  try{return await cached(request,env,key)||await importPublic(request,env,key)}
  catch(error){console.error(JSON.stringify({event:"public_media_failure",category:key.split("/")[0],message:String(error?.message||"unknown")}));return json("Media temporarily unavailable",503)}
 }
};
