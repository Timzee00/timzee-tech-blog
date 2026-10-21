import { supabase } from "./supabase.js";
import { escapeHTML } from "./utils.js";

const panels=new Map();
const polls=new Map();
const lock=new Set();
const KINDS=new Set(["video","story","chat","group"]);
const uid=id=>String(id||"").match(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i)?.[0]||"";
const safe=escapeHTML;
const key=(kind,id)=>kind+":"+id;
const fmt=iso=>iso?new Date(iso).toLocaleString():null;

function node(html){
 const element=document.createElement("div");
 element.innerHTML=html.trim();return element.firstElementChild;
}

export async function openPollComposer(kind,id,onCreated=()=>{}){
 if(!KINDS.has(kind)||!uid(id))return;
 const previous=document.getElementById("timzeePollDialog");
 previous?.remove();
 const dialog=document.createElement("dialog");
 dialog.id="timzeePollDialog";dialog.className="timzee-poll-dialog";
 dialog.innerHTML=`<form method="dialog" class="timzee-poll-form" novalidate>
 <header><h3>Create a poll</h3><button type="submit" value="cancel" aria-label="Close poll composer">×</button></header>
 <label>Question<input name="question" maxlength="280" minlength="3" required placeholder="Ask your community something"></label>
 <div class="timzee-poll-options">
 <label>Option 1<input name="option" maxlength="100" required placeholder="First answer"></label>
 <label>Option 2<input name="option" maxlength="100" required placeholder="Second answer"></label>
 <label>Option 3<input name="option" maxlength="100" placeholder="Optional"></label>
 <label>Option 4<input name="option" maxlength="100" placeholder="Optional"></label>
 <label>Option 5<input name="option" maxlength="100" placeholder="Optional"></label>
 <label>Option 6<input name="option" maxlength="100" placeholder="Optional"></label></div>
 <label>Poll ending<select name="duration">
   <option value="never">No end time</option><option value="1">1 hour</option>
   <option value="24">24 hours</option><option value="72">3 days</option><option value="168">7 days</option>
   <option value="custom">Choose date and time</option>
 </select></label>
 <label class="timzee-poll-custom" hidden>End date and time<input name="end" type="datetime-local"></label>
 <p role="status" class="timzee-poll-error" aria-live="polite"></p>
 <div class="timzee-poll-actions"><button type="button" class="timzee-poll-cancel">Cancel</button>
 <button type="button" class="timzee-poll-submit">Publish poll</button></div></form>`;
 document.body.append(dialog);
 const close=()=>dialog.close();
 dialog.addEventListener("close",()=>dialog.remove(),{once:true});
 dialog.querySelector(".timzee-poll-cancel").addEventListener("click",close);
 dialog.querySelector('[name=duration]').addEventListener("change",e=>{
   dialog.querySelector(".timzee-poll-custom").hidden=e.target.value!=="custom";
 });
 dialog.querySelector(".timzee-poll-submit").addEventListener("click",async()=>{
   const form=dialog.querySelector("form");
   const question=form.querySelector('[name=question]').value.trim();
   const options=[...form.querySelectorAll('[name=option]')].map(x=>x.value.trim()).filter(Boolean);
   const duration=form.querySelector('[name=duration]').value;
   const end=form.querySelector('[name=end]').value;
   const err=dialog.querySelector(".timzee-poll-error");
   let ends_at=null;
   if(duration==="custom"&&end)ends_at=new Date(end).toISOString();
   else if(duration!=="never"&&duration!=="custom")ends_at=new Date(Date.now()+Number(duration)*3600000).toISOString();
   if(duration==="custom"&&!end){err.textContent="Choose an end date or select No end time.";return;}
   const button=dialog.querySelector(".timzee-poll-submit");button.disabled=true;err.textContent="Publishing…";
   try{
     let targetId=id;
     if(kind==="group"){
       const {data,error}=await supabase.rpc("create_group_poll",{
         p_thread:id,p_question:question,p_options:options,p_ends_at:ends_at
       });
       if(error)throw error;
       targetId=data;
     }else{
       const {error}=await supabase.rpc("create_content_poll",{
         p_kind:kind,p_target:id,p_question:question,p_options:options,p_ends_at:ends_at
       });
       if(error)throw error;
     }
     close();
     if(kind!=="group")await refreshPoll(kind,targetId);
     await onCreated(targetId);
   }catch(e){err.textContent=e.message||"Unable to publish poll";button.disabled=false;}
 });
 dialog.showModal();dialog.querySelector('[name=question]').focus();
}

function viewHtml(poll,kind,id){
 const votes=Array.isArray(poll.counts)?poll.counts:[];
 const total=votes.reduce((n,x)=>n+Number(x||0),0);
 const ended=!!poll.closed_at||!!poll.ends_at&&new Date(poll.ends_at)<=new Date();
 return `<section class="timzee-poll" data-poll-key="${safe(key(kind,id))}" aria-label="Poll">
 <header><strong>${safe(poll.question)}</strong><small>${ended?"Closed":poll.ends_at?"Closes "+safe(fmt(poll.ends_at)):"Open poll · No end time"}</small></header>
 <div class="timzee-poll-answers">${(poll.options||[]).map((option,i)=>{
 const count=Number(votes[i]||0),pct=total?Math.round(count*100/total):0;
 return `<button type="button" data-vote-index="${i}" ${ended?"disabled":""} class="${poll.my_vote===i?"is-selected":""}"
 aria-pressed="${poll.my_vote===i?"true":"false"}">
 <span class="timzee-poll-answer-text">${safe(option)}</span>
 <span class="timzee-poll-answer-meta">${poll.my_vote!==null||ended?`${pct}% · ${count}`:"Vote"}</span>
 ${poll.my_vote!==null||ended?`<span class="timzee-poll-fill" aria-hidden="true" style="width:${pct}%"></span>`:""}
 </button>`}).join("")}</div>
 <footer><small>${total} vote${total===1?"":"s"}${poll.my_vote!==null?" · Your vote can be changed until closing":""}</small>
 ${poll.mine&&!ended?'<button class="timzee-poll-close" type="button">Close poll</button>':""}</footer>
 </section>`;
}

async function vote(poll,idx,kind,id){
 const identifier=poll.id;
 if(lock.has(identifier))return;
 lock.add(identifier);
 try{
   const {error}=await supabase.rpc("vote_content_poll",{p_poll:identifier,p_option:idx});
   if(error)throw error;await refreshPoll(kind,id);
 }catch(e){window.appUI?.toast?.(e.message||"Unable to vote");}
 finally{lock.delete(identifier);}
}

async function refreshPoll(kind,id){
 const target=uid(id),k=key(kind,target);
 const {data,error}=await supabase.rpc("polls_for_targets",{p_kind:kind,p_targets:[target]});
 if(error)throw error;
 const result=Array.isArray(data)?data[0]:null;
 if(result)polls.set(k,result);else polls.delete(k);
 const holders=panels.get(k)||new Set();
 for(const holder of [...holders]){
   if(!holder.isConnected){holders.delete(holder);continue;}
   holder.replaceChildren();
   if(!result)continue;
   const section=node(viewHtml(result,kind,target));
   holder.append(section);
   section.querySelectorAll("[data-vote-index]").forEach(b=>b.addEventListener("click",()=>{
     void vote(result,Number(b.dataset.voteIndex),kind,target);
   }));
   section.querySelector(".timzee-poll-close")?.addEventListener("click",async()=>{
     if(!await window.appUI?.confirm?.("Close this poll now?"))return;
     const {error}=await supabase.rpc("close_content_poll",{p_poll:result.id});
     if(error){window.appUI?.toast?.(error.message);return;}
     await refreshPoll(kind,target);
   });
 }
 return result;
}

export async function mountPoll(container,kind,id){
 if(!container||!KINDS.has(kind)||!uid(id))return null;
 const k=key(kind,id);
 if(!panels.has(k))panels.set(k,new Set());
 panels.get(k).add(container);
 try{return await refreshPoll(kind,id);}
 catch(e){console.warn("Could not load poll",e);return null;}
}

export function resetPollMounts(){panels.clear();}
