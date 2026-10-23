// Credentials and signing remain server-side. This route does not create rooms.
const {createClient}=require("@supabase/supabase-js");
const {parseJsonObject}=require("./_lib/request.js");
const {getUserWithTrustedRole}=require("./_lib/auth-role.js");
const {createRoomToken,UUID}=require("./_lib/spaces-token.cjs");
const json=(statusCode,payload)=>({
 statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store",
 "X-Content-Type-Options":"nosniff","Vary":"Authorization"},body:JSON.stringify(payload)
});
const urlAllowed=url=>{
 try{const parsed=new URL(url);return parsed.protocol==="wss:"&&Boolean(parsed.hostname)&&!parsed.username&&!parsed.password&&parsed.pathname==="/";}
 catch{return false;}
};
exports.handler=async event=>{
 if(event.httpMethod!=="POST")return json(405,{error:"POST required."});
 const parsed=parseJsonObject(event,4096);
 if(parsed.error)return json(parsed.statusCode,{error:parsed.error});
 const roomId=String(parsed.payload.roomId||"");
 if(!UUID.test(roomId))return json(400,{error:"Invalid room ID."});
 const bearer=event.headers?.authorization||event.headers?.Authorization||"";
 const match=/^Bearer\s+(\S+)$/i.exec(String(bearer));
 if(!match||match[1].length>4096)return json(401,{error:"Sign in required."});
 const {SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY,SERVICE_ROLE_KEY,
  LIVEKIT_URL,LIVEKIT_API_KEY,LIVEKIT_API_SECRET}=process.env;
 if(!SUPABASE_URL||!(SUPABASE_SERVICE_ROLE_KEY||SERVICE_ROLE_KEY))
  return json(503,{error:"Space authentication is not configured."});
 if(!urlAllowed(LIVEKIT_URL)||!LIVEKIT_API_KEY||!LIVEKIT_API_SECRET)
  return json(503,{error:"Live audio is not configured yet. Spaces scheduling remains available."});
 const db=createClient(SUPABASE_URL,SUPABASE_SERVICE_ROLE_KEY||SERVICE_ROLE_KEY,{
  auth:{persistSession:false,autoRefreshToken:false}
 });
 const actor=await getUserWithTrustedRole(db,match[1]);
 if(actor.error)return json(403,{error:"Your account is not authorized to join live audio."});
 const [roomResult,participantResult]=await Promise.all([
   db.from("spaces_rooms").select("id,owner_id,status,starts_at,max_duration_minutes")
    .eq("id",roomId).maybeSingle(),
   db.from("spaces_participants").select("role,state,last_seen_at")
    .eq("room_id",roomId).eq("user_id",actor.user.id).maybeSingle()
 ]);
 if(roomResult.error||participantResult.error)
  return json(503,{error:"Room authorization is temporarily unavailable."});
 const room=roomResult.data,participant=participantResult.data,now=Date.now();
 if(!room||room.status!=="live"||!participant||participant.state!=="present")
  return json(403,{error:"Join the active room before connecting audio."});
 const start=Date.parse(room.starts_at),lastSeen=Date.parse(participant.last_seen_at);
 if(!Number.isFinite(start)||!Number.isFinite(lastSeen)||start>now+30000||
   now>start+Number(room.max_duration_minutes||30)*60000||
   now-lastSeen>120000)return json(403,{error:"Room access expired. Rejoin to continue."});
 if(participant.role==="host"&&room.owner_id!==actor.user.id)
  return json(403,{error:"Room ownership mismatch."});
 try{
   const token=createRoomToken({apiKey:LIVEKIT_API_KEY,apiSecret:LIVEKIT_API_SECRET,
    userId:actor.user.id,roomId,role:participant.role,
    displayName:actor.user.user_metadata?.display_name||"Member",now});
   return json(200,{server_url:LIVEKIT_URL,participant_token:token,
     role:participant.role,expires_in:120,room_name:"space_"+roomId});
 }catch(err){
   console.error("Live Spaces signing failed",err?.message||"unknown");
   return json(503,{error:"Unable to authorize room audio."});
 }
};
exports._test={urlAllowed};
