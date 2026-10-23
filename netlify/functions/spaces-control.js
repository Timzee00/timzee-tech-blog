// Privileged voice session termination; never callable merely with a room ID.
const {createClient}=require("@supabase/supabase-js");
const {parseJsonObject}=require("./_lib/request.js");
const {getUserWithTrustedRole}=require("./_lib/auth-role.js");
const {createRoomServiceToken,UUID}=require("./_lib/spaces-token.cjs");
const json=(statusCode,payload)=>({
 statusCode,headers:{"Content-Type":"application/json","Cache-Control":"no-store",
 "X-Content-Type-Options":"nosniff"},body:JSON.stringify(payload)
});
exports.handler=async event=>{
 if(event.httpMethod!=="POST")return json(405,{error:"POST required."});
 const parsed=parseJsonObject(event,2048);
 if(parsed.error)return json(parsed.statusCode,{error:parsed.error});
 const {roomId,action,userId}=parsed.payload;
 if(!UUID.test(String(roomId))||!["end","remove"].includes(action)||
    (action==="remove"&&!UUID.test(String(userId))))return json(400,{error:"Invalid request."});
 const match=/^Bearer\s+(\S+)$/i.exec(String(event.headers?.authorization||event.headers?.Authorization||""));
 if(!match||match[1].length>4096)return json(401,{error:"Sign in required."});
 const env=process.env;
 const key=env.SUPABASE_SERVICE_ROLE_KEY||env.SERVICE_ROLE_KEY;
 if(!env.SUPABASE_URL||!key)return json(503,{error:"Space controls are unavailable."});
 if(!env.LIVEKIT_API_KEY||!env.LIVEKIT_API_SECRET||!env.LIVEKIT_URL)
  return json(503,{error:"Live audio is not configured."});
 let target;
 try{target=new URL(env.LIVEKIT_URL);
  if(target.protocol!=="wss:"||target.pathname!=="/"||target.username||target.password)throw Error("invalid");
 }catch{return json(503,{error:"Live audio server URL is invalid."})}
 const db=createClient(env.SUPABASE_URL,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const user=await getUserWithTrustedRole(db,match[1]);
 if(user.error)return json(403,{error:"Active account required."});
 const roomResult=await db.from("spaces_rooms").select("id,owner_id,status").eq("id",roomId).maybeSingle();
 if(roomResult.error)return json(503,{error:"Room permissions are temporarily unavailable."});
 if(roomResult.data?.owner_id!==user.user.id)return json(403,{error:"Only the room host may manage this session."});
 if(action==="end"&&roomResult.data.status!=="ended")
  return json(409,{error:"End the database room first."});
 if(action==="remove"){
  const result=await db.from("spaces_participants").select("state,role")
    .eq("room_id",roomId).eq("user_id",userId).maybeSingle();
  if(result.error)return json(503,{error:"Membership permissions are unavailable."});
  if(result.data?.state!=="removed"||result.data?.role==="host")
   return json(409,{error:"Remove this participant in the room controls first."});
 }
 const operation=action==="end"?"delete":"remove";
 const token=createRoomServiceToken({apiKey:env.LIVEKIT_API_KEY,
  apiSecret:env.LIVEKIT_API_SECRET,roomId,action:operation});
 const method=action==="end"?"DeleteRoom":"RemoveParticipant";
 const payload=action==="end"?{room:"space_"+roomId}:
  {room:"space_"+roomId,identity:"u_"+userId};
 try{
  const response=await fetch("https://"+target.host+"/twirp/livekit.RoomService/"+method,{
    method:"POST",signal:AbortSignal.timeout(8500),
    headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
    body:JSON.stringify(payload)
  });
  if(response.ok||(action==="end"&&response.status===404))return json(200,{ok:true});
  console.error("LiveKit room control rejected:",method,response.status);
  return json(502,{error:"Audio provider did not confirm the requested action. Please retry."});
 }catch(error){console.error("LiveKit room control unavailable:",method,error?.name||"error");
  return json(503,{error:"Live audio control timed out. Please retry."})}
};
