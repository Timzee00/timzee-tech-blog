import { supabase } from "./supabase.js";
import { escapeHTML } from "./utils.js";
import {setupMentionInput} from "./mentions.js";
import {renderSocialText} from "./social-rich-text.mjs";
import { mountPoll,openPollComposer } from "./content-polls.mjs";

const uid=value=>/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value||"");
let generation=0;
let latestKey="";
const esc=escapeHTML;
const fmtDate=date=>new Date(date).toLocaleString();

async function toggle(table,id,userId,exists){
 if(!userId)throw new Error("Sign in to use status interactions.");
 if(exists){
  const {error}=await supabase.from(table).delete().eq("story_id",id).eq("user_id",userId);
  if(error)throw error;
 }else{
  const {error}=await supabase.from(table).insert({story_id:id,user_id:userId});
  if(error)throw error;
 }
}

export async function showStoryInteractions(story,user,container,{onReshare=()=>{}}={}){
 const gen=++generation;
 const currentKey=story?.id||"";
 latestKey=currentKey;
 container.replaceChildren();
 if(!story||!uid(story.id))return;
 const own=user?.id===story.user_id,canComment=story.allow_public_comments!==false;
 const menu=document.createElement("section");menu.className="story-social-panel";
 menu.setAttribute("aria-label","Status interactions");
 menu.innerHTML=`<div class="story-social-actions">
   <button type="button" data-action="like">♡ Like</button>
   <button type="button" data-action="save">☆ Save</button>
   <button type="button" data-action="share">↗ Forward</button>
   <button type="button" data-action="reshare" ${story.allow_reshare===false||story.visibility!=="public"?"disabled":""}>⟳ Reshare</button>
   <button type="button" data-action="reply" ${own?"disabled":""}>↩ Private reply</button>
   ${own?'<button type="button" data-action="poll">+ Poll</button>':''}
 </div>
 <div class="story-status-feedback" role="status" aria-live="polite"></div>
 <div class="story-social-metrics" aria-live="polite" data-story-metrics></div>
 <div class="story-social-poll" data-story-poll></div>
 ${canComment?`<details class="story-comments-panel"><summary>Public comments <span data-comment-count></span></summary>
  <div class="story-comments-feed" data-comments-feed></div>
  <form data-comment-form><input maxlength="600" placeholder="Leave a public comment…" aria-label="Public status comment" required><button type="submit">Post</button></form>
 </details>`:'<p class="story-comments-off">Public comments are off for this status.</p>'}
 <form class="story-private-reply" data-private-reply hidden>
  <label>Private reply to the creator<input maxlength="1000" placeholder="Write a private message…" required></label>
  <button type="submit">Send privately</button><button type="button" data-action="cancel-reply">Cancel</button>
 </form>`;
 container.append(menu);
 const note=text=>{const el=menu.querySelector(".story-status-feedback");if(el)el.textContent=text;};
 let liked=false,saved=false;
 async function reloadLikes(){
  if(!user?.id)return;
  const [like,save]=await Promise.all([
   supabase.from('story_likes').select('story_id').eq('story_id',story.id).eq('user_id',user.id).maybeSingle(),
   supabase.from('story_saves').select('story_id').eq('story_id',story.id).eq('user_id',user.id).maybeSingle()
  ]);
  if(gen!==generation)return;
  liked=!!like.data;saved=!!save.data;
  const l=menu.querySelector('[data-action=like]'),s=menu.querySelector('[data-action=save]');
  if(l){l.textContent=liked?'♥ Liked':'♡ Like';l.setAttribute('aria-pressed',String(liked));}
  if(s){s.textContent=saved?'★ Saved':'☆ Save';s.setAttribute('aria-pressed',String(saved));}
  void refreshMetrics();
 }
 async function refreshMetrics(){
  const likes=await supabase.from('story_likes').select('*',{count:'exact',head:true}).eq('story_id',story.id);
  const views=own?await supabase.from('story_views').select('*',{count:'exact',head:true})
   .eq('story_id',story.id):null;
  if(gen!==generation)return;
  const metrics=menu.querySelector('[data-story-metrics]');
  if(metrics)metrics.textContent=(likes.count||0)+' likes'+
    (own?' · '+(views?.count||0)+' views (receipts enabled only)':'');
 }
 async function reloadComments(){
  const list=menu.querySelector('[data-comments-feed]');if(!list)return;
  const {data,error}=await supabase.from('story_comments')
   .select('id,user_id,body,created_at')
   .eq('story_id',story.id).order('created_at',{ascending:true}).limit(100);
  if(error){list.textContent='Could not load comments.';return;}
  if(gen!==generation)return;
  const rows=data||[];
  const ids=[...new Set(rows.map(row=>row.user_id))];
  let nameMap=new Map();
  if(ids.length){
    const profiles=await supabase.from('public_profiles').select('id,display_name,username').in('id',ids);
    nameMap=new Map((profiles.data||[]).map(p=>[p.id,p.display_name||p.username||'Member']));
  }
  if(gen!==generation)return;
  list.innerHTML=rows.map(r=>`<article><strong>${esc(nameMap.get(r.user_id)||'Member')}</strong>
    <p>${renderSocialText(r.body)}</p><small>${esc(fmtDate(r.created_at))}</small></article>`).join('')||
   '<p>No public comments yet.</p>';
  menu.querySelector('[data-comment-count]').textContent='('+rows.length+')';
 }
 menu.querySelector('[data-comment-form]')?.addEventListener('submit',async event=>{
  event.preventDefault();
  const input=event.currentTarget.querySelector('input'),body=input.value.trim();
  if(!body||!user?.id){note('Sign in to post a comment.');return;}
  const {error}=await supabase.from('story_comments')
   .insert({story_id:story.id,user_id:user.id,body});
  if(error){note(error.message);return;}
  input.value='';await reloadComments();note('Public comment posted.');
 });
 menu.querySelector('[data-private-reply]')?.addEventListener('submit',async event=>{
  event.preventDefault();if(!user?.id||own)return;
  const form=event.currentTarget,body=form.querySelector('input').value.trim();
  if(!body)return;
  const allowed=await supabase.rpc('can_send_direct_message',{p_recipient:story.user_id});
  if(allowed.error||allowed.data!==true){note('Creator has not enabled private messages from you.');return;}
  const thread_id=[user.id,story.user_id].sort().join('_');
  const {error}=await supabase.from('direct_messages').insert({
   id:crypto.randomUUID(),thread_id,sender_id:user.id,recipient_id:story.user_id,
   body:`Reply to status: ${location.origin}/stories.html?user=${encodeURIComponent(story.user_id)}\n\n${body}`,
   created_at:new Date().toISOString()
  });
  if(error){note(error.message);return;}
  note('Private reply sent.');form.hidden=true;form.reset();
 });
 menu.addEventListener('click',async event=>{
  const button=event.target.closest('button[data-action]');if(!button)return;
  const action=button.dataset.action,shareLink=`${location.origin}/stories.html?user=${encodeURIComponent(story.user_id)}`;
  try{
   if(action==='like'){await toggle('story_likes',story.id,user?.id,liked);await reloadLikes();}
   if(action==='save'){await toggle('story_saves',story.id,user?.id,saved);await reloadLikes();}
   if(action==='share'){
    if(navigator.share)await navigator.share({title:'Timzee Status',url:shareLink});
    else {await navigator.clipboard.writeText(shareLink);note('Status link copied.');}
   }
   if(action==='reshare'){
    if(!user?.id)throw new Error('Sign in to reshare.');
    if(!await window.appUI.confirm('Reshare this status to your audience?'))return;
    const {error}=await supabase.rpc('reshare_status',{p_story_id:story.id});
    if(error)throw error;
    note('Reshared as your status.');await onReshare();
   }
   if(action==='reply')menu.querySelector('[data-private-reply]').hidden=false;
   if(action==='cancel-reply')menu.querySelector('[data-private-reply]').hidden=true;
   if(action==='poll')await openPollComposer('story',story.id,()=>mountPoll(menu.querySelector('[data-story-poll]'),'story',story.id));
  }catch(e){if(e.name!=='AbortError')note(e.message||'Action unavailable.');}
 });
 if(canComment)void reloadComments();
 setupMentionInput(menu.querySelector('[data-comment-form] input'));
 setupMentionInput(menu.querySelector('[data-private-reply] input'));
 if(user?.id&&!own)void supabase.rpc('record_status_view',{p_story_id:story.id}).then(({error})=>{if(error)console.warn('Status view unavailable',error.message);});
 if(user?.id)void reloadLikes();
 if(user?.id)void mountPoll(menu.querySelector('[data-story-poll]'),'story',story.id);
}
