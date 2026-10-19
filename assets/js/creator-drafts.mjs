/* Owner-scoped draft persistence. All reads/writes additionally pass through
 * Supabase RLS and server-owned tier quotas; no service keys in this module. */
import {verifiedLevel} from "./verified-identity.mjs";
export const DRAFT_KINDS=Object.freeze([
  {id:"discussion",name:"Discussion"},
  {id:"question",name:"Question"},
  {id:"guide",name:"Tutorial / guide"},
  {id:"news",name:"Tech news"},
  {id:"showcase",name:"Project showcase"},
  {id:"video-script",name:"Video script"}
]);
export const DRAFT_COLUMNS="id,user_id,kind,title,body,community_id,created_at,updated_at";
const KINDS=new Set(DRAFT_KINDS.map(x=>x.id));
const UUID=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;

export function creatorDraftLimit(profile){
  return ({silver:25,gold:100,platinum:250,business:100})[verifiedLevel(profile)]||5;
}
export function validateCreatorDraft({kind,title,body,community_id}){
  const normalized={
    kind:String(kind||"discussion"),
    title:String(title||"").trim(),
    body:String(body||""),
    community_id:community_id||null
  };
  if(!KINDS.has(normalized.kind))throw Error("Choose a supported draft type.");
  if(normalized.title.length>180)throw Error("Draft title cannot exceed 180 characters.");
  if(normalized.body.length>12000)throw Error("Draft content cannot exceed 12,000 characters.");
  if(normalized.community_id&&!UUID.test(String(normalized.community_id)))
    throw Error("Choose a valid community.");
  return normalized;
}
export async function listCreatorDrafts(db,userId){
  if(!UUID.test(String(userId||"")))throw Error("Sign in to see your drafts.");
  const {data,error}=await db.from("creator_drafts").select(DRAFT_COLUMNS)
    .eq("user_id",userId).order("updated_at",{ascending:false}).limit(250);
  if(error)throw error;
  return data||[];
}
export async function saveCreatorDraft(db,userId,fields,id=null){
  if(!UUID.test(String(userId||"")))throw Error("Sign in to save drafts.");
  if(id!==null&&!UUID.test(String(id)))throw Error("Invalid draft identifier.");
  const payload=validateCreatorDraft(fields);
  const query=id
    ? db.from("creator_drafts").update(payload).eq("id",id).eq("user_id",userId)
    : db.from("creator_drafts").insert({...payload,user_id:userId});
  const {data,error}=await query.select(DRAFT_COLUMNS).single();
  if(error)throw error;
  return data;
}
export async function deleteCreatorDraft(db,userId,id){
  if(!UUID.test(String(userId||""))||!UUID.test(String(id||"")))
    throw Error("Invalid draft ownership or identifier.");
  const {error}=await db.from("creator_drafts").delete()
    .eq("id",id).eq("user_id",userId);
  if(error)throw error;
}
