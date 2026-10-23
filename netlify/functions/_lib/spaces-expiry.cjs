// Expired live sessions must be removed from the audio SFU before finalizing DB status.
// Server credentials stay in the scheduled Netlify Function, never in clients.
const {createRoomServiceToken,UUID}=require("./spaces-token.cjs");
const MAX_EXPIRED_PER_RUN=8;
function liveKitHost(env){
 try{
  const url=new URL(String(env?.LIVEKIT_URL||""));
  if(url.protocol!=="wss:"||url.pathname!=="/"||url.username||url.password||
   !env?.LIVEKIT_API_KEY||!env?.LIVEKIT_API_SECRET)return null;
  return "https://"+url.host;
 }catch{return null}
}
function roomIsExpired(room,now=Date.now()){
 const start=Date.parse(room?.starts_at||""),duration=Number(room?.max_duration_minutes);
 return UUID.test(String(room?.id||""))&&Number.isFinite(start)&&
  Number.isInteger(duration)&&duration>=1&&duration<=60&&
  now>=start+duration*60000;
}
async function expireSpaces({db,env,now=Date.now(),fetcher=fetch}){
 const query=await db.from("spaces_rooms")
  .select("id,starts_at,max_duration_minutes")
  .eq("status","live").order("starts_at",{ascending:true}).limit(80);
 if(query.error)throw Error("Spaces expiration query unavailable");
 const expired=(query.data||[]).filter(room=>roomIsExpired(room,now))
  .slice(0,MAX_EXPIRED_PER_RUN);
 if(!expired.length)return {checked:(query.data||[]).length,expired:0,failed:0,skipped:true};
 const base=liveKitHost(env);
 if(!base)throw Error("Expired live Spaces exist but audio-provider credentials are missing");
 const results=await Promise.all(expired.map(async room=>{
  const token=createRoomServiceToken({apiKey:env.LIVEKIT_API_KEY,
   apiSecret:env.LIVEKIT_API_SECRET,roomId:room.id,action:"delete",now});
  let response;
  try{
   response=await fetcher(base+"/twirp/livekit.RoomService/DeleteRoom",{
    method:"POST",signal:AbortSignal.timeout(6500),
    headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
    body:JSON.stringify({room:"space_"+room.id})
   });
  }catch(error){
   console.error("Spaces provider expiration request failed",room.id,error?.name||"network");
   return false;
  }
  if(!response.ok&&response.status!==404){
   console.error("Spaces provider rejected expiration",room.id,response.status);
   return false;
  }
  const finish=await db.from("spaces_rooms")
   .update({status:"ended",ended_at:new Date(now).toISOString()})
   .eq("id",room.id).eq("status","live");
  if(finish.error){
   console.error("Spaces expiration database completion failed",room.id,finish.error.code||"database");
   return false;
  }
  return true;
 }));
 const completed=results.filter(Boolean).length;
 if(completed!==expired.length)
  throw Error("Spaces expiration incomplete: "+(expired.length-completed)+" request(s) failed");
 return {checked:(query.data||[]).length,expired:completed,failed:0,skipped:false};
}
module.exports={MAX_EXPIRED_PER_RUN,liveKitHost,roomIsExpired,expireSpaces};
