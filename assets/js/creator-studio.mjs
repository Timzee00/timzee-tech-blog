import {supabase,getCurrentUser} from "./supabase.js";
import {creatorDraftLimit,listCreatorDrafts,saveCreatorDraft,deleteCreatorDraft,validateCreatorDraft} from "./creator-drafts.mjs";
import {verifiedLevel} from "./verified-identity.mjs";
import {renderCommunityMarkdown} from "./community-markdown.mjs";

const $=id=>document.getElementById(id);
const state={user:null,profile:null,drafts:[],selectedId:null,dirty:false,busy:false};
const create=(tag,klass,text)=>{
 const el=document.createElement(tag);
 if(klass)el.className=klass;
 if(text!==undefined)el.textContent=text;
 return el;
};
const kindName={discussion:"Discussion",question:"Question",guide:"Tutorial",news:"News",showcase:"Showcase","video-script":"Video script"};
function status(message,tone="neutral"){
 const node=$("creatorWorkspaceStatus");
 if(!node)return;
 node.textContent=message;node.dataset.tone=tone;
}
function formFields(){
 return {
  kind:$("creatorDraftKind").value,
  title:$("creatorDraftTitle").value,
  body:$("creatorDraftBody").value,
  community_id:$("creatorDraftCommunity").value||null
 };
}
function dirty(value){
 state.dirty=Boolean(value);
 const indicator=$("creatorSaveState");
 if(indicator){
  indicator.textContent=value?"Unsaved changes":state.selectedId?"Saved in your account":"Not yet saved";
  indicator.dataset.dirty=String(Boolean(value));
 }
 updatePreview();
}
function updatePreview(){
 $("creatorBodyCount").textContent=$("creatorDraftBody").value.length.toLocaleString()+" / 12,000";
 const script=$("creatorDraftKind").value==="video-script";
 const use=$("creatorUseDraft");
 if(use){
  use.disabled=script||state.busy;
  use.title=script?"A video script is a private note. Use it in your video editor later.":"Open this draft in the moderated community composer.";
 }
 const preview=$("creatorDraftPreview");
 if(preview.hidden)return;
 $("creatorPreviewTitle").textContent=$("creatorDraftTitle").value.trim()||"Untitled draft";
 $("creatorPreviewContent").innerHTML=renderCommunityMarkdown($("creatorDraftBody").value);
}
function clearEditor(){
 state.selectedId=null;
 $("creatorDraftForm").reset();
 $("creatorEditorHeading").textContent="New draft";
 $("creatorDeleteDraft").disabled=true;
 dirty(false);renderList();
 $("creatorDraftTitle").focus();
}
function loadEditor(draft){
 state.selectedId=draft.id;
 $("creatorDraftKind").value=draft.kind||"discussion";
 $("creatorDraftTitle").value=draft.title||"";
 $("creatorDraftBody").value=draft.body||"";
 const select=$("creatorDraftCommunity");
 select.value=draft.community_id||"";
 if(select.value!==String(draft.community_id||"")){
  select.value="";
  status("This draft's former community is unavailable. Choose another when publishing.","warning");
 }
 $("creatorEditorHeading").textContent="Edit draft";
 $("creatorDeleteDraft").disabled=false;
 dirty(false);renderList();$("creatorDraftTitle").focus();
}
function confirmDiscard(){
 return !state.dirty||window.confirm("You have unsaved changes. Discard them?");
}
function renderList(){
 const host=$("creatorDraftList");
 host.replaceChildren();
 if(!state.drafts.length){
  host.append(create("p","creator-studio-help","No saved drafts yet. Start with an idea and select Save draft."));
  return;
 }
 for(const draft of state.drafts){
  const wrapper=create("div","","");
  wrapper.setAttribute("role","listitem");
  const button=create("button","creator-draft-item");
  button.type="button";button.setAttribute("aria-current",String(draft.id===state.selectedId));
  const heading=create("strong","",draft.title.trim()||"Untitled draft");
  const date=new Date(draft.updated_at);
  const dateLabel=Number.isFinite(date.getTime())?date.toLocaleDateString():"Recently";
  const meta=create("small","",(kindName[draft.kind]||"Draft")+" · "+dateLabel);
  button.append(heading,meta);
  button.addEventListener("click",()=>{
    if(draft.id===state.selectedId||!confirmDiscard())return;
    loadEditor(draft);
  });
  wrapper.append(button);host.append(wrapper);
 }
}
function updateStats(){
 const tier=verifiedLevel(state.profile);
 $("creatorDraftTier").textContent=tier?tier[0].toUpperCase()+tier.slice(1)+" verified":"Standard member";
 $("creatorDraftCount").textContent=state.drafts.length.toLocaleString();
 $("creatorDraftLimit").textContent=creatorDraftLimit(state.profile).toLocaleString();
}
async function refreshDrafts(){
 const current=state.selectedId;
 state.drafts=await listCreatorDrafts(supabase,state.user.id);
 updateStats();renderList();
 if(current&&!state.drafts.some(d=>d.id===current)){
  state.selectedId=null;$("creatorDeleteDraft").disabled=true;
 }
}
async function saveCurrent(){
 if(!state.user||state.busy)return null;
 let fields;
 try{
  fields=validateCreatorDraft(formFields());
  if(!fields.title&&!fields.body.trim())throw Error("Write a title or some content before saving.");
 }catch(error){status(error.message,"error");return null;}
 state.busy=true;$("creatorSaveDraft").disabled=true;
 $("creatorUseDraft").disabled=true;
 status("Saving your private draft…");
 try{
  const saved=await saveCreatorDraft(supabase,state.user.id,fields,state.selectedId);
  state.selectedId=saved.id;
  $("creatorEditorHeading").textContent="Edit draft";
  $("creatorDeleteDraft").disabled=false;
  // Editing during an in-flight request must not falsely mark new text saved.
  const latest=formFields();
  const unchanged=JSON.stringify(latest)===JSON.stringify(fields);
  dirty(!unchanged);
  await refreshDrafts();
  status(unchanged?"Draft saved to your account.":"Draft saved, but you have newer unsaved edits.",unchanged?"success":"warning");
  return saved;
 }catch(error){
  status(error?.message||"Unable to save your draft.","error");
  return null;
 }finally{
  state.busy=false;$("creatorSaveDraft").disabled=false;
  updatePreview();
 }
}
async function deleteCurrent(){
 if(!state.user||!state.selectedId||state.busy)return;
 if(!window.confirm("Permanently delete this private draft?"))return;
 state.busy=true;$("creatorDeleteDraft").disabled=true;
 try{
  await deleteCreatorDraft(supabase,state.user.id,state.selectedId);
  state.selectedId=null;
  await refreshDrafts();
  clearEditor();
  status("Draft deleted from your account.","success");
 }catch(error){
  status(error?.message||"Couldn't delete the draft.","error");
 }finally{state.busy=false;$("creatorDeleteDraft").disabled=!state.selectedId;}
}
async function openInCommunity(){
 if(state.busy)return;
 if($("creatorDraftKind").value==="video-script"){
  status("Video scripts are private notes, not community posts.","warning");
  return;
 }
 if(state.dirty||!state.selectedId){
  const saved=await saveCurrent();
  if(!saved)return;
 }
 if(!state.selectedId){status("Save a draft before sending it to Communities.","error");return;}
 // The destination will re-fetch the draft using RLS. No private body in URLs.
 window.location.assign("discussion.html?draft="+encodeURIComponent(state.selectedId));
}
async function loadCommunities(){
 const {data,error}=await supabase.from("discussion_topics")
  .select("id,title").eq("community_state","active")
  .order("title",{ascending:true}).limit(100);
 if(error)return;
 const select=$("creatorDraftCommunity");
 for(const community of data||[]){
  if(!community.id||!community.title)continue;
  const option=create("option","",community.title);
  option.value=community.id;select.append(option);
 }
}
async function boot(){
 $("creatorDraftForm").addEventListener("submit",event=>{event.preventDefault();void saveCurrent();});
 $("creatorDraftForm").addEventListener("input",()=>dirty(true));
 $("creatorDraftForm").addEventListener("change",()=>dirty(true));
 $("creatorNewDraft").addEventListener("click",()=>{if(confirmDiscard())clearEditor();});
 $("creatorDeleteDraft").addEventListener("click",()=>void deleteCurrent());
 $("creatorUseDraft").addEventListener("click",()=>void openInCommunity());
 $("creatorPreviewDraft").addEventListener("click",()=>{
  const preview=$("creatorDraftPreview");
  preview.hidden=!preview.hidden;
  $("creatorPreviewDraft").setAttribute("aria-pressed",String(!preview.hidden));
  $("creatorPreviewDraft").textContent=preview.hidden?"Preview":"Hide preview";
  updatePreview();
 });
 addEventListener("beforeunload",event=>{
  if(!state.dirty)return;
  event.preventDefault();event.returnValue="";
 });
 try{state.user=await getCurrentUser();}catch(error){console.warn("Creator session unavailable",error);}
 if(!state.user){
  $("creatorSignedOut").hidden=false;
  status("Sign in to access your private Creator Studio.");
  return;
 }
 try{
  const profile=await supabase.from("public_profiles")
   .select("id,is_verified,verification_tier,verification_expires_at")
   .eq("id",state.user.id).maybeSingle();
  if(profile.error)throw profile.error;
  state.profile=profile.data||null;
  await Promise.all([loadCommunities(),refreshDrafts()]);
  $("creatorWorkspace").hidden=false;
  status("Your private drafts are ready. No content is published automatically.","success");
  updatePreview();
 }catch(error){
  $("creatorWorkspace").hidden=true;
  status(error?.message||"Creator Studio could not load your drafts. Please retry.","error");
 }
}
void boot();
