const {createClient}=require("@supabase/supabase-js");
const {parseJsonObject}=require("./_lib/request.js");
const BUCKET="story-private-media",PREFIX=BUCKET+"/",TTL=300;
const respond=(statusCode,body)=>({statusCode,headers:{
 "Content-Type":"application/json; charset=utf-8","Cache-Control":"private, no-store",
 "Referrer-Policy":"no-referrer","X-Content-Type-Options":"nosniff"},body:JSON.stringify(body)});
const validId=x=>typeof x==="string"&&/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(x);
exports.handler=async event=>{
 if(event.httpMethod!=="POST")return respond(405,{error:"Method not allowed"});
 const token=String(event.headers?.authorization||event.headers?.Authorization||"")
   .match(/^Bearer\s+([^\s]+)$/i)?.[1];
 if(!token)return respond(401,{error:"Sign in to view private statuses."});
 const parsed=parseJsonObject(event);
 if(parsed.error)return respond(parsed.statusCode,{error:parsed.error});
 const id=parsed.payload?.story_id,kind=parsed.payload?.asset;
 if(!validId(id)||!["media","music"].includes(kind))return respond(400,{error:"Invalid private media request."});
 const url=process.env.SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!url||!key)return respond(503,{error:"Private media is not configured."});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 try{
   const {data:identity,error:authError}=await db.auth.getUser(token);
   if(authError||!identity?.user?.id)return respond(401,{error:"Session expired."});
   const user=identity.user;
   const {data:story,error}=await db.from("stories")
      .select("id,user_id,visibility,media_url,music_url,expires_at")
      .eq("id",id).maybeSingle();
   if(error)return respond(503,{error:"Could not verify status access."});
   if(!story||story.visibility!=="private"||Date.parse(story.expires_at)<=Date.now())
     return respond(404,{error:"Status not available."});
   if(user.id!==story.user_id){
     const {data:connections,error:friendsError}=await db.from("friendships")
       .select("id").eq("status","accepted")
       .or("and(requester_id.eq."+user.id+",addressee_id.eq."+story.user_id+"),"+
           "and(addressee_id.eq."+user.id+",requester_id.eq."+story.user_id+")")
       .limit(1);
     if(friendsError)return respond(503,{error:"Could not verify audience."});
     if(!connections?.length)return respond(403,{error:"This status is friends-only."});
   }
   const original=kind==="media"?story.media_url:story.music_url;
   const expected=PREFIX+story.user_id+"/";
   if(typeof original!=="string"||!original.startsWith(expected))
     return respond(404,{error:"Private file not available."});
   const path=original.slice(PREFIX.length);
   if(path.length>1024||path.includes("..")||path.includes("\\")||
     !/^[a-f0-9-]{36}\/(?:music\/)?[a-f0-9-]{36}\.[a-z0-9]{2,6}$/i.test(path))
     return respond(400,{error:"Invalid private media path."});
   const {data:signed,error:signError}=await db.storage.from(BUCKET).createSignedUrl(path,TTL);
   if(signError||!signed?.signedUrl)return respond(503,{error:"Unable to securely load status."});
   return respond(200,{signedUrl:signed.signedUrl,expiresIn:TTL});
 }catch(e){
   console.error("Private story signing failed",e?.message||"Unknown failure");
   return respond(503,{error:"Private status temporarily unavailable."});
 }
};
