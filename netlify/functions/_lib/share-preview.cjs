"use strict";
// This module is server-only. The service-role client is never exposed to browsers.
// Every database lookup applies explicit public visibility and expiry filters.
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const SLUG=/^[a-z0-9][a-z0-9-]{0,129}$/i;
const FALLBACK="/assets/brand/blipmood-social-card.png";
const ROUTES={"/post.html":"post","/post":"post","/video.html":"video","/video":"video","/listing.html":"listing","/listing":"listing","/novel.html":"novel","/novel":"novel","/discussion.html":"discussion","/discussion":"discussion","/profile.html":"profile","/profile":"profile","/stories.html":"stories","/stories":"stories"};
const LABEL={post:"Article",video:"Video",listing:"Marketplace",novel:"Novel",discussion:"Community",profile:"Profile",stories:"Stories"};
function clean(value,max=230){
 let s=String(value??"").replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi," ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi," ")
 .replace(/<[^>]*>/g," ").replace(/&nbsp;|&#160;/gi," ").replace(/&amp;/gi,"&").replace(/&lt;/gi,"<")
 .replace(/&gt;/gi,">").replace(/&quot;/gi,'"').replace(/&#39;|&apos;/gi,"'").replace(/\s+/g," ").trim();
 return s.length>max?s.slice(0,max-1).replace(/\s+\S*$/,"")+"…":s;
}
function esc(x){return String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
function validUrl(value,origin){
 if(typeof value!=="string"||value.length>2100)return "";
 try{const u=new URL(value.trim(),origin);
 if(u.protocol!=="https:"||!u.hostname||u.username||u.password||u.hostname==="localhost"||/^(?:127\.|10\.|192\.168\.|169\.254\.)/.test(u.hostname))return "";
 return u.href;}catch{return "";}
}
function safeOrigin(input,production="https://timzee-tech-blog.netlify.app"){
 try{const u=new URL(input),known=new URL(production).origin;
 if(u.protocol!=="https:"||u.username||u.password)return known;
 if(u.origin===known||/^(?:[a-z0-9-]+--)?timzee-tech-blog\.netlify\.app$/i.test(u.hostname))return u.origin;
 return known;}catch{return production;}
}
function getId(params,key){const id=params.get(key)||"";return UUID.test(id)?id:null;}
function fallback(kind,origin,path){return {title:(LABEL[kind]||"Discover")+" on Blipmood",description:"Discover videos, stories and conversations from the Blipmood community.",image:origin+FALLBACK,type:"website",canonical:origin+path,found:false};}
function one(result){if(result?.error)throw Error("Public preview query failed: "+(result.error.code||"unknown"));return result?.data||null;}
async function getMeta(kind,params,db,origin,path){
 const standard=fallback(kind,origin,path),id=getId(params,"id"),now=new Date().toISOString();
 let row=null,details=null,canonicalKey="id",canonicalVal="";
 if(kind==="post"){
  const slug=params.get("slug")||"";
  if(!id&&!SLUG.test(slug))return standard;
  let q=db.from("posts").select("id,title,slug,author_name,cover,feed_excerpt,content,created_at,publish_at,status").eq("status","published");
  q=id?q.eq("id",id):q.eq("slug",slug);
  row=one(await q.maybeSingle());
  if(!row||(row.publish_at&&new Date(row.publish_at)>new Date()))return standard;
  let image=validUrl(row.cover,origin)?row.cover:"";
  if(!image){
    const m=one(await db.from("post_media").select("url,media_type").eq("post_id",row.id).eq("media_type","image").order("sort_order",{ascending:true}).limit(1).maybeSingle());
    image=m?.url||"";
  }
  if(!image)image=(String(row.content||"").match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)||[])[1]||"";
  details={title:row.title,description:row.feed_excerpt||row.content,image,type:"article",published:row.created_at,author:row.author_name};
  canonicalKey=id?"id":"slug";canonicalVal=id||slug;
 }else if(kind==="video"){
  if(!id)return standard;
  row=one(await db.from("videos").select("id,title,description,author_name,thumbnail_url,video_url,created_at,is_public").eq("id",id).eq("is_public",true).maybeSingle());
  if(!row)return standard;
  details={title:row.title||"Watch this video",description:row.description||"Watch a video on Blipmood",image:row.thumbnail_url,video:row.video_url,type:"video.other",published:row.created_at};
  canonicalVal=id;
 }else if(kind==="listing"){
  if(!id)return standard;
  row=one(await db.from("marketplace_items").select("id,title,description,images,is_available,expires_at").eq("id",id).maybeSingle());
  if(!row||(row.expires_at&&new Date(row.expires_at)<new Date()))return standard;
  const images=Array.isArray(row.images)?row.images:[];
  const image=images.map(v=>typeof v==="string"?v:(v?.url||v?.image_url||"")).find(v=>validUrl(v,origin))||"";
  details={title:row.title,description:(row.description||"View this listing")+" · "+(row.is_available?"Available":"Currently unavailable"),image,type:"product"};
  canonicalVal=id;
 }else if(kind==="novel"){
  if(!id)return standard;
  row=one(await db.from("novels").select("id,title,synopsis,cover_url,status").eq("id",id).in("status",["published","completed","ongoing","active"]).maybeSingle());
  if(!row)return standard;
  details={title:row.title,description:row.synopsis||"Read the story on Blipmood",image:row.cover_url,type:"book"};
  canonicalVal=id;
 }else if(kind==="discussion"){
  const thread=getId(params,"thread"),community=getId(params,"community")||getId(params,"topic");
  if(thread){
   row=one(await db.from("community_threads").select("id,community_id,title,body,media_url,media_type,status,created_at").eq("id",thread).eq("status","published").maybeSingle());
   if(!row)return standard;
   const board=one(await db.from("discussion_topics").select("id,title,visibility,community_state,media_url,media_type").eq("id",row.community_id).eq("visibility","public").eq("community_state","active").maybeSingle());
   if(!board)return standard;
   details={title:row.title||board.title,description:row.body||"Join the conversation",image:row.media_type==="image"?row.media_url:board.media_type==="image"?board.media_url:"",type:"article",published:row.created_at};
   canonicalKey="thread";canonicalVal=thread;
  }else if(community){
   row=one(await db.from("discussion_topics").select("id,title,description,media_url,media_type,visibility,community_state").eq("id",community).eq("visibility","public").eq("community_state","active").maybeSingle());
   if(!row)return standard;
   details={title:row.title+" · Community",description:row.description||"Join this Blipmood community",image:row.media_type==="image"?row.media_url:"",type:"website"};
   canonicalKey="community";canonicalVal=community;
  }else return standard;
 }else if(kind==="profile"){
  if(!id)return standard;
  row=one(await db.from("public_profiles").select("id,display_name,username,bio,headline,avatar_url,cover_url").eq("id",id).maybeSingle());
  if(!row)return standard;
  details={title:(row.display_name||row.username||"Member")+" on Blipmood",description:row.headline||row.bio||"View this public creator profile",image:row.cover_url||row.avatar_url,type:"profile"};
  canonicalVal=id;
 }else if(kind==="stories"){
  const story=getId(params,"story"),user=getId(params,"user");
  if(!story&&!user)return standard;
  let q=db.from("stories").select("id,user_id,caption,media_url,media_type,visibility,expires_at,allow_reshare").eq("visibility","public").gt("expires_at",now);
  q=story?q.eq("id",story):q.eq("user_id",user).order("created_at",{ascending:false}).limit(1);
  row=one(await q.maybeSingle());
  if(!row||row.allow_reshare===false)return standard;
  const person=one(await db.from("public_profiles").select("id,display_name").eq("id",row.user_id).maybeSingle());
  details={title:(person?.display_name||"Someone")+"'s story",description:row.caption||"View this public story",image:row.media_type==="image"?row.media_url:"",type:"website"};
  canonicalKey=story?"story":"user";canonicalVal=story||user;
 }else return standard;
 const qp=new URLSearchParams([[canonicalKey,canonicalVal]]);
 return {title:clean(details.title,130)||standard.title,description:clean(details.description)||standard.description,
 image:validUrl(details.image,origin)||standard.image,video:validUrl(details.video,origin),type:details.type||"website",
 published:details.published||"",author:clean(details.author||"",80),canonical:origin+path+"?"+qp.toString(),found:true};
}
function renderHTML(meta,options={}){
 const tag=(name,value,attr="property")=>value?'<meta '+attr+'="'+esc(name)+'" content="'+esc(value)+'">':"";
 const parts=['<!doctype html><html lang="en"><head><meta charset="utf-8">',
 '<meta name="viewport" content="width=device-width,initial-scale=1">',
 '<title>'+esc(meta.title+" | Blipmood")+'</title>',tag("description",meta.description,"name"),
 '<link rel="canonical" href="'+esc(meta.canonical)+'">',
 tag("robots",options.noindex?"noindex, nofollow":"index, follow","name"),
 tag("og:site_name","Blipmood"),tag("og:type",meta.type),tag("og:title",meta.title),
 tag("og:description",meta.description),tag("og:url",meta.canonical),
 tag("og:image",meta.image),tag("og:image:secure_url",meta.image),
 tag("og:image:alt",meta.title),tag("og:video",meta.video),tag("og:video:secure_url",meta.video),
 meta.video&&/\.mp4(?:$|\?)/i.test(meta.video)?tag("og:video:type","video/mp4"):"",
 tag("article:published_time",meta.published),tag("article:author",meta.author),
 tag("twitter:card","summary_large_image","name"),tag("twitter:title",meta.title,"name"),
 tag("twitter:description",meta.description,"name"),tag("twitter:image",meta.image,"name"),
 '</head><body><main><h1>'+esc(meta.title)+'</h1><p>'+esc(meta.description)+'</p>',
 '<a href="'+esc(meta.canonical)+'">View on Blipmood</a></main></body></html>'];
 return parts.filter(Boolean).join("\n");
}
module.exports={UUID,ROUTES,getMeta,renderHTML,safeOrigin,validUrl,clean,esc,fallback};