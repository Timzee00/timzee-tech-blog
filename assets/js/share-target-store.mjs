/* Temporary incoming Android share payloads. Nothing is uploaded or sent
 * until the person explicitly chooses a destination. Same origin as sw.js. */
export const SHARE_DB="blipmood-native-shares";
export const SHARE_STORE="pending";
export const SHARE_TTL=24*60*60*1000;
export const SHARE_ID=/^[a-f0-9-]{36}$/i;
export function openShareDB(){
 return new Promise((resolve,reject)=>{
  if(!("indexedDB" in globalThis))return reject(Error("This browser cannot store incoming shares."));
  const req=indexedDB.open(SHARE_DB,1);
  req.onupgradeneeded=()=>{if(!req.result.objectStoreNames.contains(SHARE_STORE))req.result.createObjectStore(SHARE_STORE,{keyPath:"id"});};
  req.onerror=()=>reject(req.error||Error("Unable to access the local share inbox."));
  req.onsuccess=()=>resolve(req.result);
 });
}
async function transaction(mode,action){
 const db=await openShareDB();
 try{
  return await new Promise((resolve,reject)=>{
   const tx=db.transaction(SHARE_STORE,mode);
   const request=action(tx.objectStore(SHARE_STORE));
   tx.oncomplete=()=>resolve(request?.result);
   tx.onerror=()=>reject(tx.error||Error("Share storage unavailable."));
   tx.onabort=()=>reject(tx.error||Error("Share storage was interrupted."));
  });
 }finally{db.close();}
}
export async function getPendingShare(id){
 if(!SHARE_ID.test(id||""))return null;
 const row=await transaction("readonly",store=>store.get(id));
 if(!row)return null;
 if(!Number.isFinite(row.createdAt)||Date.now()-row.createdAt>SHARE_TTL){
  await deletePendingShare(id);return null;
 }
 return row;
}
export async function savePendingShare(row){
 if(!row||!SHARE_ID.test(row.id||""))throw Error("Invalid incoming share.");
 if(!Number.isFinite(row.createdAt)||Date.now()-row.createdAt>SHARE_TTL)throw Error("Incoming share expired.");
 await transaction("readwrite",store=>store.put(row));
}
export async function deletePendingShare(id){
 if(!SHARE_ID.test(id||""))return;
 await transaction("readwrite",store=>store.delete(id));
}
export function safeExternalUrl(value){
 try{
  const raw=String(value||"").trim();
  if(raw.length>2048||!/^https:\/\//i.test(raw))return "";
  const parsed=new URL(raw);
  if(parsed.protocol!=="https:"||!parsed.hostname||parsed.username||parsed.password)return "";
  return parsed.href;
 }catch{return "";}
}
export function sharedUrl(payload){
 const explicit=safeExternalUrl(payload?.url);if(explicit)return explicit;
 for(const text of [String(payload?.text||""),String(payload?.title||"")]){
  for(const match of text.matchAll(/https:\/\/[^\s<>"']+/gi)){
   const candidate=safeExternalUrl(match[0].replace(/[),.!?;]+$/,""));
   if(candidate)return candidate;
  }
 }
 return "";
}
export function isSpotifyUrl(value){
 const url=safeExternalUrl(value);if(!url)return false;
 const host=new URL(url).hostname.toLowerCase();
 return host==="open.spotify.com"||host==="spotify.link";
}
export async function spotifyPreview(link){
 if(!isSpotifyUrl(link))return null;
 const response=await fetch("https://open.spotify.com/oembed?url="+encodeURIComponent(link),{
  signal:AbortSignal.timeout(6000),mode:"cors",credentials:"omit",referrerPolicy:"no-referrer"
 });
 if(!response.ok)throw Error("Spotify preview is temporarily unavailable.");
 const data=await response.json();
 const image=safeExternalUrl(data.thumbnail_url);
 return {
  title:String(data.title||"Shared on Spotify").slice(0,140),
  provider:"Spotify",
  image:image&&new URL(image).hostname==="i.scdn.co"?image:""
 };
}
export function formatShareText(payload,override=""){
 const url=sharedUrl(payload);
 const title=String(override||payload?.title||"").trim().slice(0,180);
 const body=String(payload?.text||"").trim().slice(0,4000);
 const bits=[title,body].filter(Boolean);
 if(url&&!bits.some(part=>part.includes(url)))bits.push(url);
 return bits.join("\n").slice(0,4200);
}
