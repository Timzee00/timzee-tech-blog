const {createClient}=require("@supabase/supabase-js");
const {parseJsonObject}=require("./_lib/request.js");
const BUCKET="forum-private-media",TTL=180;
const validId=x=>typeof x==="string"&&/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(x);
const respond=(statusCode,body)=>({statusCode,headers:{
 "Content-Type":"application/json; charset=utf-8","Cache-Control":"private, no-store",
 "X-Content-Type-Options":"nosniff","Referrer-Policy":"no-referrer"
},body:JSON.stringify(body)});
exports.handler=async event=>{
 if(event.httpMethod!=="POST")return respond(405,{error:"Method not allowed"});
 const token=String(event.headers?.authorization||event.headers?.Authorization||"")
 .match(/^Bearer\s+([^\s]+)$/i)?.[1];
 if(!token)return respond(401,{error:"Sign in to view this community."});
 const parsed=parseJsonObject(event);
 if(parsed.error)return respond(parsed.statusCode,{error:parsed.error});
 const {kind,item_id,position}=parsed.payload||{};
 if(!["thread","gallery","reply"].includes(kind)||!validId(item_id)||
  (kind==="gallery"&&(!Number.isInteger(position)||position<1||position>5)))
  return respond(400,{error:"Invalid media request."});
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return respond(503,{error:"Media service unavailable."});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
  const {data:identity,error:authError}=await db.auth.getUser(token);
  if(authError||!identity?.user?.id)return respond(401,{error:"Session expired."});
  const actor=identity.user.id;
  let thread=null,source=null,owner=null,replyStatus="published";
  if(kind==="thread"||kind==="gallery"){
   const found=await db.from("community_threads").select(
    "id,community_id,author_id,status,media_url").eq("id",item_id).maybeSingle();
   if(found.error||!found.data)return respond(404,{error:"Media unavailable."});
   thread=found.data;owner=thread.author_id;source=thread.media_url;
   if(kind==="gallery"){
    const gallery=await db.from("community_thread_media")
     .select("media_url,added_by").eq("thread_id",item_id)
     .eq("position",position).maybeSingle();
    if(gallery.error||!gallery.data)return respond(404,{error:"Attachment not found."});
    source=gallery.data.media_url;owner=gallery.data.added_by;
   }
  }else{
   const reply=await db.from("discussion_messages").select(
    "id,thread_id,author_id,media_url,moderation_status")
    .eq("id",item_id).maybeSingle();
   if(reply.error||!reply.data)return respond(404,{error:"Attachment unavailable."});
   owner=reply.data.author_id;source=reply.data.media_url;
   replyStatus=reply.data.moderation_status;
   const found=await db.from("community_threads").select("id,community_id,author_id,status")
    .eq("id",reply.data.thread_id).maybeSingle();
   if(found.error||!found.data)return respond(404,{error:"Topic unavailable."});
   thread=found.data;
  }
  const boardResult=await db.from("discussion_topics")
   .select("id,visibility,community_state").eq("id",thread.community_id).maybeSingle();
  if(boardResult.error||!boardResult.data||
   boardResult.data.visibility==="public"||boardResult.data.community_state!=="active")
   return respond(404,{error:"Private media not available."});
  const memberResult=await db.from("community_members")
   .select("role").eq("community_id",thread.community_id)
   .eq("user_id",actor).maybeSingle();
  if(memberResult.error)return respond(503,{error:"Unable to verify membership."});
  const role=memberResult.data?.role||"";
  const privileged=role==="owner"||role==="moderator";
  if(!role)return respond(403,{error:"This community is members-only."});
  if((thread.status!=="published"&&actor!==thread.author_id&&!privileged)||
    (replyStatus!=="published"&&actor!==owner&&!privileged))
   return respond(404,{error:"Content is unavailable."});
  if(typeof source!=="string"||!validId(owner))return respond(404,{error:"Attachment unavailable."});
  const base=BUCKET+"/"+owner+"/"+(kind==="reply"?"replies/":"threads/");
  if(!source.startsWith(base)||source.includes("..")||source.includes("?")||source.includes("#"))
   return respond(400,{error:"Invalid attachment storage."});
  const path=source.slice(BUCKET.length+1);
  if(!/^[0-9a-f-]{36}\/(?:threads|replies)\/[0-9a-f-]{36}\.(?:jpe?g|png|gif|webp|mp4|webm)$/i.test(path))
   return respond(400,{error:"Invalid attachment path."});
  const signed=await db.storage.from(BUCKET).createSignedUrl(path,TTL);
  if(signed.error||!signed.data?.signedUrl)return respond(503,{error:"Attachment temporarily unavailable."});
  return respond(200,{signedUrl:signed.data.signedUrl,expiresIn:TTL});
 }catch(error){
  console.error("Forum media signer unavailable",error?.message||"unknown");
  return respond(503,{error:"Could not load private attachment."});
 }
};
