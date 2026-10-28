"use strict";
const { createClient } = require("@supabase/supabase-js");
const {SITE_URL,validId,buildSitemap,staticEntries}=require("./_lib/public-sitemap.cjs");

// A sitemap should always help crawlers discover public pages. Even with
// unavailable Supabase keys or a transient database outage, serve valid static
// XML rather than a 500 or a broken <error> document.
exports.handler=async()=>{
 const entries=staticEntries();
 const baseHeaders={
  "Content-Type":"application/xml; charset=utf-8",
  "X-Content-Type-Options":"nosniff",
  "Cache-Control":"public, max-age=300, s-maxage=900"
 };
 const SUPABASE_URL=process.env.SUPABASE_URL;
 const SERVICE_ROLE_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!SUPABASE_URL||!SERVICE_ROLE_KEY){
  return {statusCode:200,headers:{...baseHeaders,"X-Sitemap-Source":"static-fallback"},body:buildSitemap(entries)};
 }
 try{
  const supabase=createClient(SUPABASE_URL,SERVICE_ROLE_KEY,{
   auth:{persistSession:false,autoRefreshToken:false}
  });
  const now=Date.now();
  // Only published, already-due content belongs in search. The role key
  // never leaves this server and draft/unpublished rows are not emitted.
  const {data:posts,error:postError}=await supabase.from("posts")
   .select("id,updated_at,publish_at")
   .eq("status","published").order("updated_at",{ascending:false}).limit(5000);
  if(postError)throw postError;
  for(const post of posts||[]){
   if(!validId(post.id))continue;
   if(post.publish_at&&(!Number.isFinite(Date.parse(post.publish_at))||
      Date.parse(post.publish_at)>now))continue;
   entries.push({path:"/post.html?id="+encodeURIComponent(post.id),updated_at:post.updated_at});
  }
  // Video pages have their own public flag. Never enumerate private videos.
  const {data:videos,error:videoError}=await supabase.from("videos")
   .select("id,updated_at").eq("is_public",true)
   .order("updated_at",{ascending:false}).limit(2500);
  if(videoError)throw videoError;
  for(const video of videos||[]){
   if(!validId(video.id))continue;
   entries.push({path:"/video.html?id="+encodeURIComponent(video.id),updated_at:video.updated_at});
  }
  return {statusCode:200,headers:{...baseHeaders,"X-Sitemap-Source":"public-content"},body:buildSitemap(entries)};
 }catch(error){
  // A short cache allows automatic recovery. Fail open only for the already
  // public static section URLs; never include unverified content in an outage.
  console.error("Sitemap content query failed",error?.message||"unknown");
  return {statusCode:200,headers:{...baseHeaders,"X-Sitemap-Source":"static-fallback"},
   body:buildSitemap(staticEntries())};
 }
};