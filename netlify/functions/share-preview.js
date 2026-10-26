"use strict";
const {createClient}=require("@supabase/supabase-js");
const {ROUTES,getMeta,renderHTML,safeOrigin,fallback}=require("./_lib/share-preview.cjs");
const BASE="https://timzee-tech-blog.netlify.app";
exports.handler=async function(event){
 if(event.httpMethod!=="GET"&&event.httpMethod!=="HEAD")return {statusCode:405,headers:{Allow:"GET, HEAD"},body:""};
 const args=event.queryStringParameters||{};
 const path=String(args.path||"");
 const kind=ROUTES[path];
 if(!kind)return {statusCode:404,body:"Not found"};
 const host=event.headers?.["x-forwarded-host"]||event.headers?.host||"";
 const origin=safeOrigin("https://"+host,process.env.URL||BASE);
 const params=new URLSearchParams();
 for(const key of ["id","slug","thread","community","topic","user","story"])
   if(typeof args[key]==="string"&&args[key].length<160)params.set(key,args[key]);
 let meta=fallback(kind,origin,path);
 try{
   if(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_ROLE_KEY){
     const client=createClient(process.env.SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{
       auth:{persistSession:false,autoRefreshToken:false}
     });
     meta=await getMeta(kind,params,client,origin,path);
   }
 }catch(e){
   // Never reveal database errors, keys, unpublished titles, or profile data.
   console.warn("share-preview lookup failed",kind,String(e?.message||"unavailable").slice(0,100));
 }
 const noindex=!meta.found||["deploy-preview","branch-deploy"].includes(process.env.CONTEXT||"");
 const body=renderHTML(meta,{noindex});
 return {statusCode:200,headers:{
  "Content-Type":"text/html; charset=utf-8",
  "Cache-Control":meta.found?"public, max-age=60, s-maxage=180":"no-store",
  "X-Content-Type-Options":"nosniff",
  "X-Robots-Tag":noindex?"noindex, nofollow":"index, follow",
  "Vary":"User-Agent"
 },body:event.httpMethod==="HEAD"?"":body};
};