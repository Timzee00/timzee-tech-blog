import {supabase,getCurrentUser} from "./supabase.js";
import {createStory} from "./stories.js";
import {uploadMedia} from "./media.js";
import {getChatMediaPath} from "./chat-media-path.mjs";
import {getPendingShare,savePendingShare,deletePendingShare,sharedUrl,safeExternalUrl,
 isSpotifyUrl,spotifyPreview} from "./share-target-store.mjs";

const $=id=>document.getElementById(id);
const ID=/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const MAX_CHAT=10,MAX_MEDIA_RECIPIENTS=3;
let pending=null,user=null,recipientList=[],spotify=null,objectUrl="";
let busy=false;
const recipientSelection=new Set();
const status=$("shareNotice"),app=$("shareApp");
function announce(message,{error=false,success=false}={}){
 status.textContent=message;status.dataset.error=String(error);status.dataset.success=String(success);
}
function destination(){return document.querySelector('input[name="shareDestination"]:checked')?.value||"status";}
function selectedRecipients(){return [...recipientSelection];}
function getFiles(){return (pending?.files||[]).filter(file=>file&&file.size>0);}
function mainLink(){return sharedUrl(pending);}
function displayText(){return $("shareMessage").value.trim();}
function updateDestination(){
 const dest=destination(),files=getFiles();
 $("shareStatusOptions").hidden=dest!=="status";
 $("shareChatOptions").hidden=dest!=="chat";
 $("shareCommunityOptions").hidden=dest!=="community";
 const count=selectedRecipients().length;
 $("shareSend").textContent=dest==="community"?"Review community post":
  dest==="status"?"Publish to my status":
  "Send to "+count+" recipient"+(count===1?"":"s");
 if(dest==="status"&&files.length>1)
  announce("A status accepts one photo or video. Choose Community Post to share a photo collection.",{error:true});
 else if(dest==="chat"&&files.length>1)
  announce("Chat sharing supports one attachment per message. Choose one file or post the collection in a community.",{error:true});
 else if(dest==="chat"&&count>(files.length?MAX_MEDIA_RECIPIENTS:MAX_CHAT))
  announce("Too many recipients selected for this share.",{error:true});
 else if(!busy)announce("Your item is private until you confirm.");
}
function previewTextNode(tag,text,cls=""){
 const el=document.createElement(tag);if(cls)el.className=cls;el.textContent=text;return el;
}
function renderPreview(){
 const host=$("sharePreview");host.replaceChildren();
 if(objectUrl){URL.revokeObjectURL(objectUrl);objectUrl="";}
 const files=getFiles(),link=mainLink();
 const picture=files.find(f=>f.type.startsWith("image/"))||files.find(f=>f.type.startsWith("video/"));
 const body=previewTextNode("div","","native-share-preview-body");
 if(picture){
  if(picture.type.startsWith("image/")){
   const image=document.createElement("img");image.alt="Shared photo preview";
   image.className="native-share-preview-img";objectUrl=URL.createObjectURL(picture);image.src=objectUrl;
   host.append(image);
  }else{
   host.append(previewTextNode("span","▶","native-share-preview-img"));
  }
  body.append(previewTextNode("strong",picture.name||"Shared media"));
  body.append(previewTextNode("small",files.length+" file"+(files.length===1?"":"s")+" · "+Math.round(files.reduce((total,f)=>total+f.size,0)/1024)+" KB"));
 }else if(link&&isSpotifyUrl(link)){
  if(spotify?.image){
   const image=document.createElement("img");image.alt="Spotify cover art";
   image.className="native-share-preview-img";image.src=spotify.image;image.referrerPolicy="no-referrer";
   host.append(image);
  }else host.append(previewTextNode("span","♫","native-share-preview-img"));
  body.append(previewTextNode("strong",spotify?.title||pending.title||"Shared Spotify music"));
  body.append(previewTextNode("small","Spotify · Linked preview (no copied audio)"));
 }else{
  body.append(previewTextNode("strong",pending.title||"Shared from your phone"));
 }
 if(!files.length&&pending.text)body.append(previewTextNode("p",pending.text.slice(0,550)));
 host.append(body);
 const anchor=$("shareOpenLink");
 anchor.hidden=!link;
 if(link){anchor.href=link;anchor.textContent=isSpotifyUrl(link)?"Open on Spotify":"Open original link";}
 $("shareFileHint").textContent=files.length>1?"Multiple images can be shared through a community post. Statuses and chats support one file per send.":"";
}
function renderRecipients(){
 const list=$("shareRecipients");
 list.replaceChildren();
 const query=$("shareRecipientSearch").value.trim().toLowerCase();
 let shown=0;
 for(const recipient of recipientList){
  if(query&&!recipient.label.toLowerCase().includes(query))continue;
  shown++;
  const sent=Boolean(pending.sentTo?.[recipient.key]),uncertain=Boolean(pending.uncertainTo?.[recipient.key]);
  const label=document.createElement("label");label.className="native-share-recipient";
  const input=document.createElement("input");
  input.type="checkbox";input.value=recipient.key;input.dataset.shareTo="";
  input.disabled=sent||uncertain;input.checked=recipientSelection.has(recipient.key)&&!input.disabled;
  input.addEventListener("change",()=>{if(input.checked)recipientSelection.add(recipient.key);else recipientSelection.delete(recipient.key);updateDestination();});
  const name=document.createElement("span");
  name.append(previewTextNode("strong",recipient.label));
  name.append(previewTextNode("small",sent?"Already sent":uncertain?"Delivery uncertain · check chat first":recipient.kind==="group"?"Group":"Friend"));
  label.append(input,name);list.append(label);
 }
 if(!shown)list.append(previewTextNode("p",query?"No matching recipients.":"No friends or groups available."));
}
async function loadRecipients(){
 const userId=user.id;
 const [friends,groups]=await Promise.all([
  supabase.from("friendships").select("requester_id,addressee_id,status")
   .eq("status","accepted").or("requester_id.eq."+userId+",addressee_id.eq."+userId).limit(500),
  supabase.from("chat_members").select("thread_id,chat_threads(id,name,is_group)")
   .eq("user_id",userId).limit(200)
 ]);
 if(friends.error||groups.error)throw friends.error||groups.error;
 const friendIds=[...new Set((friends.data||[]).map(row=>row.requester_id===userId?row.addressee_id:row.requester_id))]
   .filter(id=>ID.test(id)&&id!==userId);
 const profiles=friendIds.length?
  await supabase.from("public_profiles").select("id,username,display_name").in("id",friendIds):
  {data:[],error:null};
 if(profiles.error)throw profiles.error;
 const profileMap=new Map((profiles.data||[]).map(p=>[p.id,p]));
 recipientList=friendIds.map(id=>({
  kind:"friend",key:"u:"+id,id,label:"@"+(profileMap.get(id)?.username||profileMap.get(id)?.display_name||"Member")
 }));
 for(const item of groups.data||[]){
  const group=item.chat_threads;
  if(group?.is_group===true&&ID.test(group.id))
   recipientList.push({kind:"group",key:"g:"+group.id,id:group.id,label:group.name||"Group"});
 }
 recipientList.sort((a,b)=>a.label.localeCompare(b.label));
 renderRecipients();updateDestination();
}
function writeCenteredText(ctx,text,x,y,maxWidth,lineHeight,maxLines){
 const words=String(text||"").split(/\s+/).filter(Boolean),lines=[];
 let row="";
 for(const word of words){
  const next=row?row+" "+word:word;
  if(ctx.measureText(next).width>maxWidth&&row){lines.push(row);row=word;}
  else row=next;
 }
 if(row)lines.push(row);
 for(const [i,line] of lines.slice(0,maxLines).entries())
  ctx.fillText(line,x,y+i*lineHeight,maxWidth);
}
async function generateSharePoster(){
 const canvas=document.createElement("canvas");canvas.width=720;canvas.height=1280;
 const ctx=canvas.getContext("2d");if(!ctx)throw Error("This browser cannot create a status card.");
 const spotifyShare=isSpotifyUrl(mainLink());
 const background=ctx.createLinearGradient(0,0,720,1280);
 background.addColorStop(0,spotifyShare?"#51240c":"#0f504b");
 background.addColorStop(1,spotifyShare?"#130c09":"#0b1725");
 ctx.fillStyle=background;ctx.fillRect(0,0,720,1280);
 ctx.strokeStyle="rgba(255,255,255,0.12)";ctx.lineWidth=2;
 ctx.strokeRect(50,250,620,740);
 ctx.textAlign="center";ctx.fillStyle="#fff";
 ctx.font="700 38px sans-serif";ctx.fillText(spotifyShare?"♫  SPOTIFY":"BLIPMOOD",360,330);
 ctx.font="700 52px sans-serif";
 const heading=(spotify?.title||pending.title||displayText()||"Shared with you").slice(0,160);
 writeCenteredText(ctx,heading,360,570,570,70,5);
 ctx.font="28px sans-serif";ctx.fillStyle="#b8f2e7";
 writeCenteredText(ctx,spotifyShare?"Open on Spotify to listen":mainLink()?"Open the link in this status":"A moment worth sharing",360,955,570,38,2);
 ctx.fillStyle="rgba(255,255,255,.65)";ctx.font="24px sans-serif";
 ctx.fillText("Shared on Blipmood",360,1180);
 const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",.85));
 if(!blob)throw Error("Couldn't prepare a status card. Try sharing a photo.");
 return new File([blob],"shared-card.jpg",{type:"image/jpeg"});
}
function statusCaption(){
 const link=mainLink(),msg=displayText();
 if(link&&link.length>196)throw Error("The link is too long for a status. Share it in a chat or community instead.");
 if(link){
  const lead=msg.replace(link,"").trim().slice(0,Math.max(0,195-link.length));
  return (lead?lead+"\n":"")+link;
 }
 return msg.slice(0,200);
}
async function publishStatus(){
 const files=getFiles();
 if(files.length>1)throw Error("Choose one photo or video for a status.");
 const file=files[0]||await generateSharePoster();
 if(file.size>50*1024*1024)throw Error("The media exceeds the 50 MB story limit.");
 const visibility=document.querySelector('input[name="shareVisibility"]:checked')?.value||"public";
 const result=await createStory({
  userId:user.id,file,caption:statusCaption(),visibility,
  durationHours:Number($("shareDuration").value)||24,
  allowReshare:$("shareAllowReshare").checked,
  allowPublicComments:$("shareAllowComments").checked
 });
 if(result.error)throw Error(result.error.message||"Could not publish this story.");
 await deletePendingShare(pending.id);
 announce("Your status was published. You can view it in Stories.",{success:true});
 $("shareSend").disabled=true;
 const view=document.createElement("a");view.href="/stories.html";view.textContent="View my statuses";
 view.className="native-share-login";$("shareApp").append(view);
}
async function sendToRecipient(recipient){
 const key=recipient.key;
 if(pending.sentTo?.[key])return;
 if(pending.uncertainTo?.[key])throw Error("One delivery has an uncertain result. Check that chat before trying again.");
 if(recipient.kind==="friend"){
  const permission=await supabase.rpc("can_send_direct_message",{p_recipient:recipient.id});
  if(permission.error||permission.data!==true)
   throw Error("Messaging is restricted by this person's privacy or block settings.");
 }
 const id=pending.attemptIds?.[key]||crypto.randomUUID();
 pending.attemptIds={...(pending.attemptIds||{}),[key]:id};
 await savePendingShare(pending);
 const file=getFiles()[0]||null;
 let mediaUrl="",mediaPath=null,mediaType="";
 if(file){
  mediaUrl=await uploadMedia(file,"direct-messages");
  mediaPath=getChatMediaPath(mediaUrl);
  if(!mediaPath)throw Error("The uploaded attachment has no valid private storage path.");
  mediaType=file.type.startsWith("video/")?"video":"image";
 }
 const threadId=recipient.kind==="group"?recipient.id:[user.id,recipient.id].sort().join("_");
 const message={
  id,thread_id:threadId,sender_id:user.id,recipient_id:recipient.kind==="friend"?recipient.id:null,
  body:(()=>{
   const typed=displayText(),link=mainLink();
   const caption=(typed||String(pending.title||"").trim()).slice(0,3900);
   return (caption+(link&&!caption.includes(link)?"\n"+link:"")).slice(0,4000);
  })(),
  media_url:mediaUrl,media_path:mediaPath,media_type:mediaType
 };
 let confirmed=false;
 try{
  const result=await supabase.from("direct_messages").insert(message);
  if(result.error)throw result.error;
  confirmed=true;
 }catch(error){
  // A dropped connection after INSERT may mean the server accepted it.
  // Confirm by stable message ID before allowing a retry.
  const verification=await supabase.from("direct_messages").select("id").eq("id",id).maybeSingle()
   .catch(()=>({error:{message:"Unable to verify delivery"}}));
  if(verification.data?.id===id)confirmed=true;
  else if(verification.error||/network|fetch|timeout|abort/i.test(String(error?.message||""))){
   pending.uncertainTo={...(pending.uncertainTo||{}),[key]:true};
   await savePendingShare(pending);
   throw Error("Delivery could not be confirmed for "+recipient.label+". Check that chat before retrying.");
  }else throw error;
 }
 if(confirmed){
  pending.sentTo={...(pending.sentTo||{}),[key]:true};
  await savePendingShare(pending);
 }
}
async function sendChats(){
 const keys=selectedRecipients(),files=getFiles();
 if(!keys.length)throw Error("Select at least one recipient.");
 if(files.length>1)throw Error("For messages, choose one file per share.");
 if(keys.length>(files.length?MAX_MEDIA_RECIPIENTS:MAX_CHAT))
  throw Error(files.length?"Choose up to three recipients for media.":"Choose up to ten recipients.");
 if(!files.length&&!displayText()&&!mainLink()&&!String(pending.title||"").trim())throw Error("Nothing to send.");
 let sent=0;
 for(const key of keys){
  const recipient=recipientList.find(row=>row.key===key);
  if(!recipient)throw Error("A recipient could not be verified.");
  announce("Sending "+(sent+1)+" of "+keys.length+"…");
  try{await sendToRecipient(recipient);}
  catch(error){renderRecipients();throw Error(sent+" sent; "+recipient.label+" failed: "+(error.message||"Try again."));}
  recipientSelection.delete(key);
  sent++;
 }
 recipientSelection.clear();renderRecipients();
 announce(sent+" message"+(sent===1?"":"s")+" sent successfully.",{success:true});
 $("shareSend").disabled=true;
 const link=document.createElement("a");link.href="/chat.html";link.textContent="Open Chats";
 link.className="native-share-login";$("shareApp").append(link);
}
async function submitShare(){
 if(!user||busy||!pending)return;
 if(navigator.onLine===false){announce("You're offline. Reconnect to publish or send.",{error:true});return;}
 busy=true;$("shareSend").disabled=true;
 try{
  const dest=destination();
  if(dest==="community"){
   const files=getFiles();
   if(files.some(f=>f.size>12*1024*1024))throw Error("Community uploads support up to 12 MB per image or video.");
   pending.text=displayText();
   if(!pending.title&&spotify?.title)pending.title=spotify.title;
   await savePendingShare(pending);
   location.assign("/discussion.html?incoming_share="+encodeURIComponent(pending.id));return;
  }
  if(dest==="status")await publishStatus();
  else await sendChats();
 }catch(error){announce(error.message||"Sharing failed. Your draft is preserved.",{error:true});}
 finally{busy=false;if(!$("shareApp").querySelector(".native-share-login"))$("shareSend").disabled=false;}
}
async function boot(){
 const id=new URLSearchParams(location.search).get("id");
 if(!id){announce("Choose Share → Blipmood from another app to send something here.",{error:true});return;}
 try{pending=await getPendingShare(id);}
 catch(error){announce(error.message||"Unable to open this device's share inbox.",{error:true});return;}
 if(!pending){announce("That shared item has expired or is no longer available on this device.",{error:true});return;}
 pending.sentTo=pending.sentTo||{};pending.uncertainTo=pending.uncertainTo||{};pending.attemptIds=pending.attemptIds||{};
 $("shareMessage").value=String(pending.text||"").slice(0,4000);
 renderPreview();
 const link=mainLink();
 if(link&&isSpotifyUrl(link)){
  try{spotify=await spotifyPreview(link);renderPreview();}
  catch(error){console.warn("Spotify link preview unavailable:",error.message);}
 }
 try{user=await getCurrentUser();}
 catch(error){console.warn("Session unavailable",error);}
 if(!user?.id){
  $("shareSignIn").hidden=false;
  $("shareLoginLink").href="/login.html?next="+encodeURIComponent("/share-inbox.html?id="+pending.id);
  announce("Sign in to choose where this item goes.");
  return;
 }
 $("shareApp").hidden=false;
 try{
  const profile=await supabase.from("profiles").select("is_verified").eq("id",user.id).maybeSingle();
  if(profile.data?.is_verified){
   for(const option of $("shareDuration").querySelectorAll("option[data-verified-only],option[value='48'],option[value='72']")){
    option.hidden=false;option.disabled=false;
   }
  }
 }catch(error){console.warn("Verified story duration unavailable",error);}
 document.querySelectorAll('input[name="shareDestination"]').forEach(input=>input.addEventListener("change",updateDestination));
 $("shareRecipientSearch").addEventListener("input",renderRecipients);
 $("shareSend").addEventListener("click",submitShare);
 $("shareDiscard").addEventListener("click",async()=>{
  if(busy)return;
  if(!window.confirm("Discard the shared item from this device?"))return;
  try{await deletePendingShare(pending.id);location.replace("/index.html");}
  catch(error){announce(error.message||"Could not discard this item.",{error:true});}
 });
 updateDestination();
 void loadRecipients().catch(error=>{
  $("shareRecipients").replaceChildren(previewTextNode("p","Recipients could not load: "+(error.message||"try again.")));
 });
}
window.addEventListener("pagehide",()=>{if(objectUrl)URL.revokeObjectURL(objectUrl);});
boot().catch(error=>announce(error.message||"Unable to prepare this share.",{error:true}));