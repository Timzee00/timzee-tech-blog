import {supabase,getCurrentUser} from "./supabase.js";
const $=id=>document.getElementById(id);
const UUID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const tabs=["live","upcoming","mine","here"];
const q=new URLSearchParams(location.search);
const state={user:null,rooms:[],room:null,roomId:null,tab:"live",participants:[],profiles:new Map(),joined:false,role:"listener",livekit:null,heartbeat:null,poll:null,lastReactionAt:0,busy:false,mutedUsers:new Set(),audioConfigured:false,capabilityChecked:false,roomsRequestId:0};
const el=(tag,text="",className="")=>{const item=document.createElement(tag);item.textContent=String(text);if(className)item.className=className;return item};
const alertStatus=(message,tone="neutral")=>{const s=$("spacesStatus");s.textContent=message;s.dataset.tone=tone};
const audioStatus=message=>$("spaceAudioStatus").textContent=message;
function success(response){if(response.error)throw response.error;return response.data}
function validId(value){return UUID.test(String(value||""))}
function authRequired(){if(state.user)return true;alertStatus("Sign in to host or join live audio.","error");return false}
const button=(text,onclick)=>{const b=el("button",text,"btn ghost sm");b.type="button";b.addEventListener("click",onclick);return b};
const dateLabel=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toLocaleString():"Unscheduled"};
const roomExpired=room=>room?.status==="live"&&Number.isFinite(Date.parse(room.starts_at))&&
 Date.now()>=Date.parse(room.starts_at)+Math.max(1,Number(room.max_duration_minutes)||30)*60000;
async function loadAudioCapabilities(){
 try{
  const response=await fetch("/.netlify/functions/spaces-capabilities",{method:"GET",cache:"no-store"});
  const data=await response.json();
  state.audioConfigured=response.ok&&data.audioConfigured===true;
 }catch(error){
  console.warn("Audio provider readiness unavailable:",error);
  state.audioConfigured=false;
 }finally{
  state.capabilityChecked=true;
  const option=$("spacesTiming").querySelector('option[value="now"]');
  if(option)option.disabled=!state.audioConfigured;
  if(!state.audioConfigured&&$("spacesTiming").value==="now"){
   $("spacesTiming").value="later";
   $("spacesDateField").hidden=false;
  }
 }
 return state.audioConfigured;
}
async function loadRooms(){
 const requestId=++state.roomsRequestId;
 const tab=state.tab;
 if((tab==="mine"&&!state.user)||(tab==="here"&&
   !["community","post","workspace"].some(key=>validId(q.get(key))))){
  state.rooms=[];renderRooms();return;
 }
 let query=supabase.from("spaces_rooms")
  .select("id,owner_id,workspace_id,post_id,community_id,title,description,visibility,status,starts_at,capacity,max_duration_minutes,allow_requests");
 const now=Date.now();
 if(tab==="live"){
  // All configured room durations are at most 60 minutes.
  query=query.eq("status","live")
   .gte("starts_at",new Date(now-60*60000).toISOString());
 }else if(tab==="upcoming"){
  query=query.eq("status","scheduled")
   .gte("starts_at",new Date(now-5*60000).toISOString());
 }else if(tab==="mine"){
  query=query.eq("owner_id",state.user.id);
 }else if(tab==="here"){
  const fields=[["community","community_id"],["post","post_id"],["workspace","workspace_id"]];
  const match=fields.find(([key])=>validId(q.get(key)));
  query=query.eq(match[1],q.get(match[0]));
 }
 try{
  const rows=success(await query.order("starts_at",{ascending:tab==="upcoming"}).limit(50))||[];
  if(requestId!==state.roomsRequestId)return; // Discard stale network responses after a tab switch.
  state.rooms=rows;renderRooms();
 }catch(error){
  if(requestId!==state.roomsRequestId)return;
  state.rooms=[];renderRooms();
  alertStatus(error.message||"Space discovery is temporarily unavailable.","error");
 }
}
function visibleRooms(){
 const room=state.rooms;
 if(state.tab==="live")return room.filter(r=>r.status==="live"&&!roomExpired(r));
 if(state.tab==="upcoming")return room.filter(r=>r.status==="scheduled");
 if(state.tab==="mine")return state.user?room.filter(r=>r.owner_id===state.user.id):[];
 const here=[q.get("community"),q.get("post"),q.get("workspace")].find(validId);
 return here?room.filter(r=>[r.workspace_id,r.post_id,r.community_id].includes(here)):[];
}
function renderRooms(){
 const list=$("spacesList");list.replaceChildren();
 const rooms=visibleRooms();
 if(!rooms.length)list.append(el("p",state.tab==="here"?
  "Open a Space from an article, community, or organization to see its linked sessions.":
  "Nothing here yet. Start a meaningful conversation.","studio-muted"));
 for(const r of rooms){
  const article=el("article","","space-item");
  const live=r.status==="live"&&!roomExpired(r);
  const badge=el("span",roomExpired(r)?"TIME ENDED":live?"● LIVE":r.status==="scheduled"?"◷ UPCOMING":"ENDED",
   live?"space-live-badge":"space-live-badge space-upcoming-badge");
  const title=el("h3",r.title),intro=el("p",r.description||"Join the conversation.");
  intro.textContent=intro.textContent.slice(0,120);
  article.append(badge,title,intro,el("p",dateLabel(r.starts_at)+" · "+r.capacity+" seats · "+r.visibility));
  article.append(button("View Space →",()=>void openRoom(r.id)));
  list.append(article);
 }
}
function setTab(name){
 if(!tabs.includes(name))return;
 state.tab=name;
 document.querySelectorAll("[data-space-tab]").forEach(node=>{
  const selected=node.dataset.spaceTab===name;
  node.classList.toggle("active",selected);node.setAttribute("aria-selected",String(selected));
 });
 void loadRooms();
}
async function loadWorkspaces(){
 if(!state.user)return;
 const result=await supabase.from("team_workspaces").select("id,name,kind").limit(50);
 if(result.error)return;
 const select=$("spacesWorkspace");
 for(const ws of result.data||[]){const option=el("option",ws.name+" · "+ws.kind);option.value=ws.id;select.append(option)}
 const id=q.get("workspace");if(validId(id)&&[...select.options].some(o=>o.value===id))select.value=id;
}
function showCreate(show){$("spacesCreate").hidden=!show;if(show){$("spacesCreate").scrollIntoView({behavior:"smooth",block:"start"});$("spacesCreateForm").elements.title.focus()}}
async function createRoom(event){
 event.preventDefault();if(!authRequired()||state.busy)return;
 const form=event.currentTarget,f=Object.fromEntries(new FormData(form).entries());
 if(f.timing==="now"&&!state.audioConfigured){
  alertStatus("Live audio is not configured. You can schedule a Space, but cannot go live yet.","error");return;
 }
 const now=new Date();
 const starts=f.timing==="now"?now:new Date(f.starts_at);
 if(!Number.isFinite(starts.getTime())||starts.getTime()<now.getTime()-60000) {
  alertStatus("Choose a valid start time in the future.","error");return;
 }
 for(const key of ["post_id","community_id","workspace_id"])if(f[key]&&!validId(f[key])){
  alertStatus("The related "+key+" must be a valid record ID.","error");return}
 state.busy=true;$("spacesSubmit").disabled=true;
 try{
  const room=success(await supabase.from("spaces_rooms").insert({
   owner_id:state.user.id,title:f.title.trim(),description:f.description.trim(),
   visibility:f.visibility,starts_at:starts.toISOString(),capacity:Number(f.capacity),
   max_duration_minutes:Number(f.duration),allow_requests:f.allow_requests==="true",
   workspace_id:f.workspace_id||null,post_id:f.post_id||null,community_id:f.community_id||null
  }).select("id").single());
  if(f.timing==="now"){
   const started=success(await supabase.rpc("spaces_start",{p_room:room.id}));
   if(!started)throw Error("Room created but could not go live. Open it to start when eligible.");
  }
  form.reset();showCreate(false);await loadRooms();await openRoom(room.id);
  alertStatus(f.timing==="now"?"Space is live; join to connect your microphone.":"Space scheduled. Audio must be configured before going live.","success");
 }catch(e){alertStatus(e.message||"Could not create Space.","error")}
 finally{state.busy=false;$("spacesSubmit").disabled=false}
}
async function openRoom(id){
 if(!validId(id))return;
 await leave();
 state.roomId=id;
 $("spacesDiscovery").hidden=true;$("spaceDetail").hidden=false;
 $("spaceTitle").textContent="Loading Space…";$("spaceSourceLinks").replaceChildren();
 await refreshRoom();
 history.replaceState({}, "", "spaces.html?room="+encodeURIComponent(id));
}
async function refreshRoom(){
 if(!state.roomId)return;
 const result=await supabase.from("spaces_rooms")
  .select("id,owner_id,workspace_id,post_id,community_id,title,description,visibility,status,starts_at,capacity,max_duration_minutes,allow_requests")
  .eq("id",state.roomId).maybeSingle();
 if(result.error){alertStatus(result.error.message,"error");return}
 if(!result.data){state.room=null;$("spaceTitle").textContent="Private Space";
  $("spaceDescription").textContent="Sign in and use Join to enter a valid link-only or invitation-only room.";
  configureControls();return;
 }
 state.room=result.data;renderDetail();await loadPeople();
}
function renderDetail(){
 const r=state.room;if(!r)return;
 $("spaceTitle").textContent=r.title;
 $("spaceDescription").textContent=r.description||"Live technology conversation";
 $("spaceLiveBadge").textContent=roomExpired(r)?"TIME ENDED":r.status==="live"?"● LIVE":r.status==="scheduled"?"◷ UPCOMING":"ENDED";
 $("spaceLiveBadge").classList.toggle("space-upcoming-badge",r.status!=="live");
 $("spaceMeta").textContent=dateLabel(r.starts_at)+" · "+r.visibility+" · "+r.capacity+
 " seats · "+r.max_duration_minutes+" min max";
 const links=$("spaceSourceLinks");links.replaceChildren();
 if(r.post_id){const a=el("a","Read connected article","btn ghost sm");a.href="post.html?id="+encodeURIComponent(r.post_id);links.append(a)}
 if(r.community_id){const a=el("a","Community discussions","btn ghost sm");a.href="discussion.html";links.append(a)}
 if(r.workspace_id){const a=el("a","Team workspace","btn ghost sm");a.href="team-workspaces.html";links.append(a)}
 configureControls();
}
function configureControls(){
 const room=state.room,host=Boolean(room&&state.user?.id===room.owner_id);
 const live=room?.status==="live",scheduled=room?.status==="scheduled";
 $("spaceJoin").hidden=state.joined||!state.audioConfigured||Boolean(room&&(room.status!=="live"||roomExpired(room)));
 $("spaceStart").hidden=!host||!scheduled||!state.audioConfigured;
 $("spaceEnd").hidden=!host;
 $("spaceEnd").textContent=room?.status==="ended"?"Confirm audio stopped":"End room";
 $("spaceLeave").hidden=!state.joined;
 $("spaceReport").hidden=!state.joined;
 $("spaceMic").hidden=!state.joined||!state.livekit||!["host","speaker"].includes(state.role);
 $("spaceAsk").hidden=!state.joined||state.role!=="listener"||!room?.allow_requests;
 // Hosts also need a recovery path when their audio connection drops.
 const reconnect=$("spaceReconnect");
 reconnect.hidden=!state.joined||!live||roomExpired(room)||
   (state.role==="host"&&Boolean(state.livekit));
 reconnect.textContent=state.livekit?"↻ Refresh speaking access":"↻ Reconnect audio";
 $("spaceHostPanel").hidden=!host;
 if(host)void loadRequests();
}
async function loadPeople(){
 if(!state.roomId||!state.room)return;
 const response=await supabase.from("spaces_participants").select("user_id,role,state,last_seen_at")
 .eq("room_id",state.roomId).eq("state","present").limit(50);
 if(response.error){audioStatus("Participants unavailable: "+response.error.message);return}
 const cutoff=Date.now()-120000;
 state.participants=(response.data||[]).filter(p=>Date.parse(p.last_seen_at)>=cutoff);
 const ids=state.participants.map(p=>p.user_id).filter(validId);
 if(ids.length){
  const profiles=await supabase.from("public_profiles").select("id,display_name,username,avatar_url")
  .in("id",ids).limit(50);
  if(!profiles.error)for(const p of profiles.data||[])state.profiles.set(p.id,p);
 }
 const render=(container,people)=>{
  container.replaceChildren();
  for(const p of people){
   const profile=state.profiles.get(p.user_id),name=profile?.display_name||profile?.username||"Member";
   const row=el("div","","space-person"),avatar=el("span",(name[0]||"?").toUpperCase(),"avatar");
   avatar.setAttribute("aria-hidden","true");
   row.append(avatar,el("strong",name),el("small",p.role));
   if(state.joined&&p.user_id!==state.user?.id){
    const muted=state.mutedUsers.has(p.user_id);
    row.append(button(muted?"Unmute here":"Mute for me",()=>{
      if(state.mutedUsers.has(p.user_id))state.mutedUsers.delete(p.user_id);
      else state.mutedUsers.add(p.user_id);
      for(const audio of $("spaceAudioElements").querySelectorAll("audio[data-speaker-id]"))
       if(audio.dataset.speakerId===p.user_id)audio.muted=state.mutedUsers.has(p.user_id);
      void loadPeople();
    }));
    if(state.user?.id===state.room?.owner_id){
     row.append(button("Remove",()=>void removeParticipant(p.user_id)));
    }
   }
   container.append(row);
  }
 };
 render($("spacesSpeakers"),state.participants.filter(p=>p.role!=="listener"));
 const listeners=state.participants.filter(p=>p.role==="listener");
 render($("spacesListeners"),listeners);$("spaceListenerCount").textContent=String(listeners.length);
 const lead=state.participants.find(p=>p.role==="host")||state.participants.find(p=>p.role==="speaker");
 if(lead&&!state.livekit)setSpeaking(lead.user_id,false);
}
function setSpeaking(participantId,active=true){
 const profile=state.profiles.get(String(participantId||"").replace(/^u_/,""));
 const name=profile?.display_name||profile?.username||"Speaker";
 $("activeSpeaker").textContent=name;
 $("activeSpeakerAvatar").textContent=(name[0]||"🎙").toUpperCase();
 $("activeSpeakerAvatar").classList.toggle("speaking",active);
}
async function authenticateRoom(){
 const session=success(await supabase.auth.getSession()).session;
 if(!session?.access_token)throw Error("Sign in again to connect audio.");
 const resp=await fetch("/.netlify/functions/spaces-token",{
  method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},
  body:JSON.stringify({roomId:state.roomId}),cache:"no-store"
 });
 const result=await resp.json().catch(()=>({}));
 if(!resp.ok)throw Error(result.error||"Live audio authorization failed");
 return result;
}
async function startAudio(){
 if(!window.LivekitClient)throw Error("Live audio library is unavailable on this network.");
 const grant=await authenticateRoom(),sdk=window.LivekitClient;
 const livekit=new sdk.Room({audioCaptureDefaults:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
 livekit.on(sdk.RoomEvent.TrackSubscribed,(track,publication,participant)=>{
  if(track.kind!==sdk.Track.Kind.Audio)return;
  const node=track.attach();node.autoplay=true;node.dataset.spaceAudio="true";
  const userId=String(participant?.identity||"").replace(/^u_/,"");
  node.dataset.speakerId=userId;
  node.muted=state.mutedUsers.has(userId);
  $("spaceAudioElements").append(node);
 });
 livekit.on(sdk.RoomEvent.TrackUnsubscribed,track=>{for(const node of track.detach())node.remove()});
 livekit.on(sdk.RoomEvent.ActiveSpeakersChanged,speakers=>{
  if(speakers.length)setSpeaking(speakers[0].identity,true);
  else $("activeSpeakerAvatar").classList.remove("speaking");
 });
 livekit.on(sdk.RoomEvent.DataReceived,(payload,participant,kind,topic)=>{
  if(topic!=="reactions"||payload.byteLength>128)return;
  try{
   const data=JSON.parse(new TextDecoder().decode(payload));
   if(data?.type==="reaction"&&["🔥","😂","👏","🙌","💯"].includes(data.emoji)){
    const id=String(participant?.identity||"").replace(/^u_/,"");
    $("reactionNotice").textContent=data.emoji+" from "+(state.profiles.get(id)?.display_name||"a listener");
   }
  }catch{}
 });
 livekit.on(sdk.RoomEvent.ParticipantConnected,()=>void loadPeople());
 livekit.on(sdk.RoomEvent.ParticipantDisconnected,()=>void loadPeople());
 livekit.on(sdk.RoomEvent.Disconnected,()=>{
  if(state.livekit!==livekit)return;
  state.livekit=null;
  $("spaceAudioElements").replaceChildren();
  configureControls();
  audioStatus("Audio disconnected. Use Reconnect to restore playback or microphone.");
  alertStatus("Space membership retained, but audio disconnected.","error");
 });
 try{
  await livekit.connect(grant.server_url,grant.participant_token);
  await livekit.localParticipant.setMicrophoneEnabled(false);
 }catch(error){
  livekit.disconnect();
  throw error;
 }
 state.livekit=livekit;state.role=grant.role;
 $("spacePlayAudio").hidden=Boolean(livekit.canPlaybackAudio);
 audioStatus("Audio connected as "+grant.role+". Microphone is off.");
 configureControls();
}
async function connectJoinedRoom(){
 try{
  await startAudio();return true;
 }catch(error){
  if(state.livekit){const failed=state.livekit;state.livekit=null;failed.disconnect()}
  audioStatus("Could not connect audio: "+(error.message||"Unavailable")+". Use Reconnect to retry.");
  configureControls();return false;
 }
}
async function join(){
 if(!authRequired()||!state.roomId)return;
 try{
  state.role=success(await supabase.rpc("spaces_join",{p_room:state.roomId}));
  if(!state.role)throw Error("Room access was not granted.");
  state.joined=true;
  await refreshRoom();
  const connected=await connectJoinedRoom();
  startPolling();
  alertStatus(connected?"Audio connected. Your microphone starts muted.":
   "Room joined, but audio did not connect. Use Reconnect to try again.",
   connected?"success":"error");
 }catch(error){alertStatus(error.message||"Unable to join.","error")}
}
function stopPolling(){
 if(state.heartbeat)clearInterval(state.heartbeat);if(state.poll)clearInterval(state.poll);
 state.heartbeat=null;state.poll=null;
}
function startPolling(){
 stopPolling();
 state.heartbeat=setInterval(async()=>{
  if(!state.joined)return;
  const result=await supabase.rpc("spaces_heartbeat",{p_room:state.roomId});
  if(result.error||!result.data){
   audioStatus("Room session ended or cannot be verified; disconnecting.");
   await leave();
  }
 },45000);
 state.poll=setInterval(async()=>{await loadPeople();if(state.role==="host")await loadRequests()},15000);
}
async function leave(callRpc=true){
 stopPolling();
 if(state.livekit){
  // Clear the active connection before intentional disconnect: the LiveKit
  // Disconnected callback must not report a user-initiated Leave as failure.
  const existing=state.livekit;state.livekit=null;
  await existing.localParticipant.setMicrophoneEnabled(false).catch(()=>{});
  existing.disconnect();
 }
 $("spaceAudioElements").replaceChildren();$("spacePlayAudio").hidden=true;
 if(callRpc&&state.joined&&state.roomId&&state.user)
  await supabase.rpc("spaces_leave",{p_room:state.roomId}).catch(()=>{});
 state.joined=false;state.role="listener";configureControls();
}
async function goLive(){
 if(!state.roomId)return;
 if(!state.audioConfigured){alertStatus("Live audio is not configured. Schedule the room until audio is connected.","error");return;}
 try{const okay=success(await supabase.rpc("spaces_start",{p_room:state.roomId}));
  if(!okay)throw Error("Space cannot start yet or has already ended.");
  await refreshRoom();await loadRooms();alertStatus("Your Space is live.","success");
 }catch(e){alertStatus(e.message||"Could not start.","error")}
}
async function providerControl(action,userId=null){
 const session=success(await supabase.auth.getSession()).session;
 if(!session?.access_token)throw Error("Sign in again to use host audio controls.");
 const response=await fetch("/.netlify/functions/spaces-control",{
  method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},
  body:JSON.stringify({roomId:state.roomId,action,userId}),cache:"no-store"
 });
 const result=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(result.error||"Audio provider has not confirmed this action.");
 return result;
}
async function endRoom(){
 if(!state.roomId||!state.room||!confirm("End this room and disconnect everyone?"))return;
 try{
  const wasScheduled=state.room.status==="scheduled";
  if(state.room.status!=="ended"){
   const okay=success(await supabase.rpc("spaces_end",{p_room:state.roomId}));
   if(!okay)throw Error("Room was already ended.");
  }
  // An already-ended room can still have LiveKit tracks after a failed
  // provider shutdown. Allow the host to confirm/retry DeleteRoom.
  if(!wasScheduled){
   if(!state.audioConfigured)throw Error("Audio provider is unavailable to confirm shutdown.");
   await providerControl("end");
  }
  await leave();await refreshRoom();
  alertStatus(wasScheduled?"Scheduled room cancelled.":"Room and audio shutdown confirmed.","success");
 }catch(e){
  await refreshRoom();
  alertStatus("The room may be ended in the database, but audio shutdown was not confirmed: "+
   (e.message||"Unknown failure")+". Use Confirm audio stopped to retry.","error");
 }
}
async function removeParticipant(userId){
 if(!validId(userId)||state.user?.id!==state.room?.owner_id)return;
 if(!confirm("Remove this participant from the live room?"))return;
 try{
  const removed=success(await supabase.rpc("spaces_remove_participant",{p_room:state.roomId,p_user:userId}));
  if(!removed)throw Error("Participant has already left.");
  await providerControl("remove",userId);
  await loadPeople();
  alertStatus("Participant removed from voice and room.","success");
 }catch(e){
  await loadPeople();
  alertStatus("Participant blocked in database. Audio removal confirmation: "+e.message,"error");
 }
}
async function requestMic(){
 try{success(await supabase.rpc("spaces_request_speaker",{p_room:state.roomId}));
  alertStatus("Request sent to the host. Refresh speaking access after approval.","success");
 }catch(e){alertStatus(e.message||"Request failed.","error")}
}
async function refreshSpeaking(){
 if(!state.joined||!state.roomId)return;
 try{
  const heartbeat=await supabase.rpc("spaces_heartbeat",{p_room:state.roomId});
  if(heartbeat.error||!heartbeat.data)throw Error("Room session expired. Leave and rejoin.");
  await leave(false);
  state.role=success(await supabase.rpc("spaces_join",{p_room:state.roomId}));
  if(!state.role)throw Error("Room access renewal was denied.");
  state.joined=true;
  const connected=await connectJoinedRoom();
  startPolling();
  alertStatus(connected?"Audio reconnected. Your microphone starts muted.":
   "Room access restored, but audio remains unavailable. Try Reconnect again.",
   connected?"success":"error");
 }catch(error){
  audioStatus(error.message||"Could not renew audio.");
  alertStatus(error.message||"Reconnect failed. Leave and rejoin.","error");
 }
}
async function loadRequests(){
 if(!state.room||state.user?.id!==state.room.owner_id)return;
 const response=await supabase.from("spaces_speaker_requests").select("user_id,status")
  .eq("room_id",state.room.id).eq("status","pending").limit(25);
 if(response.error)return;
 const queue=$("spaceRequests");queue.replaceChildren();
 if(!response.data?.length)queue.append(el("p","No pending requests.","studio-muted"));
 for(const item of response.data||[]){
  const row=el("div","","studio-row");
  row.append(el("strong","Listener "+item.user_id.slice(0,8)));
  for(const [title,approved] of [["Approve",true],["Decline",false]]){
   row.append(button(title,async()=>{
    try{success(await supabase.rpc("spaces_review_speaker",{p_room:state.room.id,p_user:item.user_id,p_approve:approved}));
    await loadRequests();await loadPeople();alertStatus("Request "+(approved?"approved":"declined")+". Speaker must reconnect audio.","success")}
    catch(e){alertStatus(e.message,"error")}
   }));
  }queue.append(row);
 }
}
async function inviteListener(event){
 event.preventDefault();if(!state.room)return;
 const field=event.currentTarget.elements.username,username=field.value.trim();
 if(!/^[A-Za-z0-9_.]{3,32}$/.test(username))return;
 try{
  const person=success(await supabase.from("public_profiles").select("id").eq("username",username).maybeSingle());
  if(!person)throw Error("Username not found");
  success(await supabase.rpc("spaces_invite",{p_room:state.room.id,p_user:person.id}));
  field.value="";alertStatus("Invitation saved. Share the private room link with this member.","success");
 }catch(e){alertStatus(e.message||"Could not invite listener.","error")}
}
async function shareRoom(){
 const url=location.origin+"/spaces.html?room="+encodeURIComponent(state.roomId);
 try{if(navigator.share)await navigator.share({title:state.room?.title||"Live Space",url});
 else{await navigator.clipboard.writeText(url);alertStatus("Room link copied.","success")}}
 catch(e){if(e.name!=="AbortError")alertStatus("Unable to share link.","error")}
}
async function react(symbol){
 if(!state.joined||!state.livekit){
  alertStatus("Connect to live audio to send reactions.","error");return;
 }
 if(Date.now()-state.lastReactionAt<2500)return;
 state.lastReactionAt=Date.now();
 try{
  await state.livekit.localParticipant.publishData(
    new TextEncoder().encode(JSON.stringify({type:"reaction",emoji:symbol})),
    {reliable:false,topic:"reactions"}
  );
  $("reactionNotice").textContent=symbol+" Sent";
 }catch(error){alertStatus("Reaction unavailable on this connection.","error")}
}
async function init(){
 await loadAudioCapabilities();
 state.user=await getCurrentUser().catch(()=>null);
 if(!state.user)alertStatus("You can browse public rooms. Sign in to speak or host.");
 else {alertStatus(state.audioConfigured?"Explore or create a Space. Microphone starts muted.":"You can schedule Spaces, but live audio is not configured yet.");await loadWorkspaces()}
 const linkedPost=q.get("post"),linkedCommunity=q.get("community");
 if(validId(linkedPost))$("spacesPostId").value=linkedPost;
 if(validId(linkedCommunity))$("spacesCommunityId").value=linkedCommunity;
 const linkedProject=q.get("project");
 if(state.user&&validId(linkedProject)){
  const project=await supabase.from("team_studio_projects")
   .select("title,body,workspace_id").eq("id",linkedProject).maybeSingle();
  if(!project.error&&project.data){
   $("spacesCreateForm").elements.title.value=project.data.title.slice(0,120);
   $("spacesCreateForm").elements.description.value=(project.data.body||"").slice(0,700);
   const select=$("spacesWorkspace");
   if([...select.options].some(option=>option.value===project.data.workspace_id))
    select.value=project.data.workspace_id;
   showCreate(true);
  }
 }
 if(state.user&&validId(linkedPost)&&!validId(linkedProject)){
  const article=await supabase.from("posts").select("title,status").eq("id",linkedPost).maybeSingle();
  if(!article.error&&article.data?.status==="published"){
   $("spacesCreateForm").elements.title.value=("Discussion: "+article.data.title).slice(0,120);
   showCreate(true);
  }
 }
 if(q.has("post")||q.has("workspace")||q.has("community")||q.has("project"))setTab("here");
 await loadRooms();
 const selected=q.get("room");
 if(validId(selected)){await openRoom(selected)}
}
$("spacesCreateToggle").addEventListener("click",()=>{if(authRequired())showCreate(true)});
$("spacesCancel").addEventListener("click",()=>showCreate(false));
$("spacesTiming").addEventListener("change",event=>{$("spacesDateField").hidden=event.target.value!=="later"});
$("spacesCreateForm").addEventListener("submit",createRoom);
$("spacesRefresh").addEventListener("click",()=>void loadRooms());
document.querySelectorAll("[data-space-tab]").forEach(b=>b.addEventListener("click",()=>setTab(b.dataset.spaceTab)));
$("spaceBack").addEventListener("click",async()=>{
 await leave();state.roomId=null;state.room=null;
 $("spaceDetail").hidden=true;$("spacesDiscovery").hidden=false;
 history.replaceState({},"","spaces.html");await loadRooms();
});
$("spaceShare").addEventListener("click",()=>void shareRoom());
$("spaceReport").addEventListener("click",()=>{
 if(!state.joined)return;
 $("spaceReportDialog").showModal();
 $("spaceReportReason").focus();
});
$("spaceReportCancel").addEventListener("click",()=>$("spaceReportDialog").close());
$("spaceReportForm").addEventListener("submit",async event=>{
 event.preventDefault();
 if(!state.joined||!state.user?.id||!validId(state.roomId))return;
 const form=event.currentTarget,reason=form.elements.reason.value.trim();
 if(reason.length<10||reason.length>500)return;
 const submit=event.submitter;submit.disabled=true;
 try{
  const result=await supabase.from("spaces_reports").insert({
   room_id:state.roomId,reporter_id:state.user.id,reason
  });
  if(result.error)throw result.error;
  form.reset();$("spaceReportDialog").close();
  alertStatus("Your report was received for moderation review.","success");
 }catch(error){alertStatus(error.message||"Unable to submit report.","error")}
 finally{submit.disabled=false}
});
$("spaceStart").addEventListener("click",goLive);
$("spaceEnd").addEventListener("click",endRoom);
$("spaceJoin").addEventListener("click",join);
$("spaceLeave").addEventListener("click",async()=>{await leave();alertStatus("Left the room.","success")});
$("spacePlayAudio").addEventListener("click",async()=>{
 if(!state.livekit)return;
 try{await state.livekit.startAudio();$("spacePlayAudio").hidden=true;
  audioStatus("Playback enabled. Your microphone remains muted until you switch it on.")}
 catch(e){audioStatus("Sound could not start: "+e.message)}
});
$("spaceAsk").addEventListener("click",requestMic);
$("spaceReconnect").addEventListener("click",refreshSpeaking);
$("spaceMic").addEventListener("click",async()=>{
 if(!state.livekit)return;
 try{const next=!state.livekit.localParticipant.isMicrophoneEnabled;
  await state.livekit.localParticipant.setMicrophoneEnabled(next);
  $("spaceMic").textContent=next?"🎙 Mute mic":"🎙 Turn on mic";
  audioStatus(next?"Microphone live; other listeners can hear you.":"Microphone muted.");
 }catch(e){audioStatus("Unable to enable microphone: "+e.message)}
});
document.querySelectorAll("[data-react]").forEach(b=>b.addEventListener("click",()=>void react(b.dataset.react)));
$("spaceInviteForm").addEventListener("submit",inviteListener);
window.addEventListener("pagehide",()=>{stopPolling();if(state.livekit)state.livekit.disconnect()});
init().catch(e=>alertStatus(e.message||"Could not load Live Spaces.","error"));