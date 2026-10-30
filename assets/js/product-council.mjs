import {supabase} from "./supabase.js";

const $=id=>document.getElementById(id);
const PAGE=16;
const ROLE_NAMES=Object.freeze({
 product_lead:"Product Lead",product_manager:"Product Manager",
 product_advisor:"Product Advisor",community_advisor:"Community Advisor",
 community_contributor:"Community Contributor",beta_tester:"Beta Tester",
 research_contributor:"Research Contributor",design_contributor:"Design Contributor",
 launch_reviewer:"Launch Reviewer"
});
const KINDS=Object.freeze({
 all:["Overview","Track work and participate in accountable product decisions."],
 initiative:["Roadmap","Initiatives organized for the next product releases."],
 proposal:["Ideas","Review proposed improvements and prioritize by evidence."],
 bug:["Bug triage","Investigate problems with clear reproduction steps."],
 beta:["Beta Lab","Coordinate controlled early testing without enabling a live feature flag."],
 mission:["Missions","Structured challenges for contributors and product teams."],
 session:["Council sessions","Document agendas, decisions and next actions."],
 release_review:["Release reviews","Record approval recommendations; only authorized release operators deploy."],
 feedback:["Feedback","Collect structured feedback from appointed members."],
 research:["Research","Make data-informed recommendations without exposing private user records."]
});
const STATUS=["proposed","triage","planned","in_progress","testing","approved","shipped","closed"];
const MEMBER_KINDS=new Set(["proposal","bug","feedback"]);
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
let actor=null,canManage=false,isLead=false,selected="all",offset=0,hasMore=false,busy=false;
let myVotes=new Set(),myInvites=new Map();
function el(tag,className,text){
 const node=document.createElement(tag);
 if(className)node.className=className;
 if(text!==undefined)node.textContent=String(text);
 return node;
}
function setStatus(node,message,error=false){
 node.textContent=String(message);
 node.dataset.state=error?"error":"ok";
}
function shortDate(date){
 const n=new Date(date);
 return Number.isNaN(n.valueOf())?"":n.toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"});
}
function friendlyError(e){
 const msg=String(e?.message||"Action could not be completed.");
 if(/permission denied|row-level security|violates row-level|not allowed|42501/i.test(msg))
  return "You do not have permission for this action. Your appointment may have expired or been revoked.";
 if(/relation .* does not exist|could not find the table|could not find the function|schema cache|PGRST205|PGRST202/i.test(msg))
  return "The Product Council database migration has not yet been applied. Nothing was changed.";
 return msg.slice(0,260);
}
async function getMember(handle){
 const clean=String(handle||"").trim().replace(/^@/,"");
 if(!/^[a-z0-9_.-]{2,70}$/i.test(clean))throw Error("Enter a valid @username.");
 const {data,error}=await supabase.from("public_profiles").select("id,username").eq("username",clean).maybeSingle();
 if(error)throw error;
 if(!uuid.test(data?.id||""))throw Error("No matching public username found.");
 return data;
}
function makeButton(text,callback,css="pc-button"){
 const b=el("button",css,text);b.type="button";b.addEventListener("click",callback);return b;
}
async function checkedRpc(name,args){
 const {data,error}=await supabase.rpc(name,args);
 if(error)throw error;
 return Boolean(data);
}
async function renderCredits(){
 const target=$("pcCredits");
 try{
  const {data,error}=await supabase.from("council_credits")
   .select("user_id,contribution,created_at").eq("published",true)
   .order("created_at",{ascending:false}).limit(12);
  if(error)throw error;
  target.replaceChildren();
  if(!data?.length){target.append(el("p","pc-muted","No public contribution credits yet."));return;}
  const ids=[...new Set(data.map(x=>x.user_id).filter(x=>uuid.test(x)))];
  const {data:people,error:usersError}=await supabase.from("public_profiles").select("id,username").in("id",ids);
  if(usersError)throw usersError;
  const handles=new Map((people||[]).map(p=>[p.id,p.username]));
  for(const credit of data){
   const card=el("article","pc-credit");
   card.append(el("strong","",handles.has(credit.user_id)?"@"+handles.get(credit.user_id):"Blipmood contributor"));
   card.append(el("p","",credit.contribution),el("small","pc-muted",shortDate(credit.created_at)));
   target.append(card);
  }
 }catch(error){target.replaceChildren(el("p","pc-muted",friendlyError(error)));}
}
function managerElements(){
 for(const option of document.querySelectorAll("#pcKind [data-manager]")){
  option.disabled=!canManage;option.hidden=!canManage;
 }
 if(!canManage&&!MEMBER_KINDS.has($("pcKind").value))$("pcKind").value="proposal";
}
async function loadStats(){
 try{
  const [total,mine]=await Promise.all([
   supabase.from("council_items").select("id",{count:"exact",head:true}),
   supabase.from("council_items").select("id",{count:"exact",head:true}).eq("assignee_id",actor.id)
  ]);
  if(!total.error)$("pcCount").textContent=Number(total.count||0).toLocaleString();
  if(!mine.error)$("pcMyCount").textContent=Number(mine.count||0).toLocaleString();
 }catch{}
}
async function getPage(start){
 let q=supabase.from("council_items")
  .select("id,kind,title,body,status,priority,created_at,updated_at,author_id,assignee_id,due_at")
  .order("created_at",{ascending:false}).range(start,start+PAGE-1);
 if(selected!=="all")q=q.eq("kind",selected);
 const {data,error}=await q;
 if(error)throw error;
 return data||[];
}
async function loadItems(reset=true){
 if(busy)return;
 busy=true;
 const list=$("pcItems"),more=$("pcLoadMore");
 more.disabled=true;
 if(reset){offset=0;list.replaceChildren(el("p","pc-muted","Loading Council items…"));}
 try{
  const rows=await getPage(offset);
  if(reset)list.replaceChildren();
  hasMore=rows.length===PAGE;
  const ids=rows.map(x=>x.id);
  const userIds=[...new Set(rows.flatMap(r=>[r.author_id,r.assignee_id]).filter(x=>uuid.test(x||"")))];
  const [people,votes,invites]=await Promise.all([
   userIds.length?supabase.from("public_profiles").select("id,username").in("id",userIds):Promise.resolve({data:[],error:null}),
   ids.length?supabase.from("council_votes").select("item_id").eq("user_id",actor.id).in("item_id",ids):Promise.resolve({data:[],error:null}),
   ids.length?supabase.from("council_beta_enrollments").select("id,item_id,status").eq("user_id",actor.id).in("item_id",ids):Promise.resolve({data:[],error:null})
  ]);
  if(people.error)throw people.error;
  if(votes.error)throw votes.error;
  if(invites.error)throw invites.error;
  const handles=new Map((people.data||[]).map(p=>[p.id,"@"+p.username]));
  myVotes=new Set((votes.data||[]).map(v=>v.item_id));
  myInvites=new Map((invites.data||[]).map(v=>[v.item_id,v]));
  if(!rows.length&&reset)list.append(el("p","pc-muted","Nothing in this workspace yet. Be the first to submit a thoughtful proposal."));
  for(const item of rows)list.append(renderItem(item,handles));
  offset+=rows.length;more.hidden=!hasMore;
  void loadStats();
 }catch(error){if(reset)list.replaceChildren();list.append(el("p","pc-muted",friendlyError(error)));more.hidden=true;}
 finally{busy=false;more.disabled=false;}
}
function renderItem(item,handles){
 const card=el("article","pc-card");
 const header=el("div","pc-item-header");
 header.append(el("span","pc-kind",String(item.kind).replaceAll("_"," ")),
   el("span","pc-status",String(item.status).replaceAll("_"," ")),
   el("small","",shortDate(item.created_at)+" · "+(handles.get(item.author_id)||"Council member")));
 card.append(header,el("h3","",item.title),el("p","pc-description",item.body));
 if(item.assignee_id)card.append(el("p","pc-muted","Owner: "+(handles.get(item.assignee_id)||"Assigned member")));
 const actions=el("div","pc-actions");
 const detail=el("div","pc-detail");detail.hidden=true;
 actions.append(makeButton("Discussion",async()=>{
  if(!detail.hidden){detail.hidden=true;return;}
  detail.hidden=false;detail.replaceChildren(el("p","pc-muted","Loading discussion…"));
  await loadDiscussion(detail,item.id);
 }));
 if(["proposal","initiative"].includes(item.kind)){
  const voted=myVotes.has(item.id);
  actions.append(makeButton(voted?"✓ Supported":"Support idea",async event=>{
   const b=event.currentTarget;b.disabled=true;
   const q=myVotes.has(item.id)
    ?supabase.from("council_votes").delete().eq("item_id",item.id).eq("user_id",actor.id)
    :supabase.from("council_votes").insert({item_id:item.id,user_id:actor.id});
   const {error}=await q;
   if(error){const errorNote=el("span","pc-muted",friendlyError(error));actions.append(errorNote);}
   else{myVotes.has(item.id)?myVotes.delete(item.id):myVotes.add(item.id);b.textContent=myVotes.has(item.id)?"✓ Supported":"Support idea";}
   b.disabled=false;
  }));
 }
 const invitation=myInvites.get(item.id);
 if(item.kind==="beta"&&invitation?.status==="invited"){
  for(const [accept,label] of [[true,"Accept beta invitation"],[false,"Decline"]]){
   actions.append(makeButton(label,async ev=>{
    const b=ev.currentTarget;b.disabled=true;
    const {error}=await supabase.from("council_beta_enrollments")
     .update({status:accept?"accepted":"declined"}).eq("id",invitation.id).eq("user_id",actor.id);
    if(error){actions.append(el("span","pc-muted",friendlyError(error)));}
    else{myInvites.set(item.id,{...invitation,status:accept?"accepted":"declined"});await loadItems();}
    b.disabled=false;
   }));
  }
 }else if(item.kind==="beta"&&invitation){
  actions.append(el("span","pc-status","Your beta access: "+invitation.status));
 }
 if(canManage){
  actions.append(makeButton("Manage",()=>{detail.hidden=!detail.hidden;if(!detail.hidden)showManager(detail,item);}));
 }
 card.append(actions,detail);
 return card;
}
async function loadDiscussion(container,itemId){
 container.replaceChildren(el("h4","","Discussion"));
 const messages=el("div");
 container.append(messages);
 try{
  const {data,error}=await supabase.from("council_comments")
   .select("body,created_at,author_id").eq("item_id",itemId)
   .order("created_at",{ascending:false}).limit(30);
  if(error)throw error;
  if(!data?.length)messages.append(el("p","pc-muted","No discussion yet."));
  for(const message of data||[]){
   const line=el("div","pc-comment",message.body);
   line.append(el("small","",shortDate(message.created_at)));
   messages.append(line);
  }
 }catch(error){messages.replaceChildren(el("p","pc-muted",friendlyError(error)));}
 const form=el("form","pc-form");
 const label=el("label","","Your comment");const textarea=el("textarea");textarea.required=true;textarea.minLength=2;textarea.maxLength=1800;textarea.rows=3;
 const submit=el("button","pc-button pc-button-primary","Post comment");submit.type="submit";
 const result=el("p");result.setAttribute("role","status");
 form.append(label,textarea,submit,result);
 form.addEventListener("submit",async event=>{
  event.preventDefault();if(!form.reportValidity())return;
  submit.disabled=true;
  const {error}=await supabase.from("council_comments").insert({item_id:itemId,author_id:actor.id,body:textarea.value.trim()});
  if(error)setStatus(result,friendlyError(error),true);
  else await loadDiscussion(container,itemId);
  submit.disabled=false;
 });
 container.append(form);
}
function showManager(container,item){
 container.replaceChildren(el("h4","","Manage "+item.kind.replaceAll("_"," ")));
 const form=el("form","pc-inline");
 const statusLabel=el("label","","Status");
 const status=el("select");
 for(const name of STATUS){const o=el("option","",name.replaceAll("_"," "));o.value=name;if(item.status===name)o.selected=true;status.add(o);}
 const ownerLabel=el("label","","Assign to @username (optional)");
 const owner=el("input");owner.placeholder="username";owner.maxLength=70;
 statusLabel.append(status);ownerLabel.append(owner);
 const save=el("button","pc-button pc-button-primary","Save changes");save.type="submit";
 const result=el("p","pc-muted");result.setAttribute("role","status");
 form.append(statusLabel,ownerLabel,save);container.append(form,result);
 form.addEventListener("submit",async e=>{
  e.preventDefault();save.disabled=true;
  try{
   const patch={status:status.value};
   if(owner.value.trim())patch.assignee_id=(await getMember(owner.value)).id;
   const {error}=await supabase.from("council_items").update(patch).eq("id",item.id);
   if(error)throw error;setStatus(result,"Updated and recorded in the audit log.");await loadStats();
  }catch(err){setStatus(result,friendlyError(err),true);}
  finally{save.disabled=false;}
 });
 if(item.kind==="beta"){
  const invite=el("form","pc-inline"),lab=el("label","","Invite a Beta Tester @username"),username=el("input");
  username.placeholder="@username";username.required=true;
  lab.append(username);
  const btn=el("button","pc-button","Send beta invitation");btn.type="submit";
  const response=el("p","pc-muted");response.setAttribute("role","status");
  invite.append(lab,btn);container.append(invite,response);
  invite.addEventListener("submit",async e=>{
   e.preventDefault();btn.disabled=true;
   try{
    const member=await getMember(username.value);
    const {error}=await supabase.from("council_beta_enrollments").insert({item_id:item.id,user_id:member.id,invited_by:actor.id});
    if(error)throw error;
    setStatus(response,"Invitation saved. The tester can accept from their Council workspace.");invite.reset();
   }catch(err){setStatus(response,friendlyError(err),true);}
   finally{btn.disabled=false;}
  });
 }
 const creditForm=el("form","pc-inline"),userLabel=el("label","","Recognize contributor @username"),
 user=el("input"),contributionLabel=el("label","","Verified contribution"),contribution=el("input");
 user.required=true;contribution.required=true;contribution.minLength=5;contribution.maxLength=280;contribution.placeholder="What meaningful work did they contribute?";
 userLabel.append(user);contributionLabel.append(contribution);
 creditForm.append(userLabel,contributionLabel);
 let publish;
 if(isLead){const label=el("label","","Publish credit now?");publish=el("input");publish.type="checkbox";publish.style.width="auto";label.append(publish);creditForm.append(label);}
 const creditBtn=el("button","pc-button","Add contribution credit");creditBtn.type="submit";
 const creditStatus=el("p","pc-muted");creditStatus.setAttribute("role","status");
 creditForm.append(creditBtn);container.append(creditForm,creditStatus);
 creditForm.addEventListener("submit",async e=>{
  e.preventDefault();if(!creditForm.reportValidity())return;creditBtn.disabled=true;
  try{
   const member=await getMember(user.value);
   const {error}=await supabase.from("council_credits").insert({
    item_id:item.id,user_id:member.id,contribution:contribution.value.trim(),credited_by:actor.id,published:Boolean(publish?.checked)
   });
   if(error)throw error;
   setStatus(creditStatus,"Contribution recorded with audit history.");creditForm.reset();if(publish?.checked)void renderCredits();
  }catch(err){setStatus(creditStatus,friendlyError(err),true);}
  finally{creditBtn.disabled=false;}
 });
}
async function openCreate(){
 const form=$("pcCreateForm");form.hidden=!form.hidden;
 if(!form.hidden){$("pcKind").value=MEMBER_KINDS.has(selected)||canManage&&selected!=="all"?selected:"proposal";managerElements();$("pcTitle").focus();}
}
function wireEvents(){
 $("pcTabs").addEventListener("click",event=>{
  const button=event.target.closest?.("button[data-kind]");if(!button)return;
  selected=button.dataset.kind;
  for(const control of $("pcTabs").querySelectorAll("button"))control.setAttribute("aria-pressed",String(control===button));
  $("pcSectionTitle").textContent=KINDS[selected]?.[0]||"Overview";
  $("pcSectionHint").textContent=KINDS[selected]?.[1]||"";
  void loadItems();
 });
 $("pcNewButton").addEventListener("click",openCreate);
 $("pcCancelCreate").addEventListener("click",()=>{$("pcCreateForm").hidden=true;});
 $("pcLoadMore").addEventListener("click",()=>loadItems(false));
 $("pcCreateForm").addEventListener("submit",async event=>{
  event.preventDefault();
  const form=event.currentTarget;if(!form.reportValidity())return;
  const submit=$("pcCreateSubmit");submit.disabled=true;
  const kind=$("pcKind").value,title=$("pcTitle").value.trim(),body=$("pcBody").value.trim();
  try{
   if(!Object.hasOwn(KINDS,kind)||kind==="all"||!canManage&&!MEMBER_KINDS.has(kind))throw Error("That item type requires Product Manager or Product Lead access.");
   const {error}=await supabase.from("council_items").insert({kind,title,body,author_id:actor.id});
   if(error)throw error;
   setStatus($("pcCreateResult"),"Submitted. Thank you for contributing to Blipmood.");
   form.reset();form.hidden=true;await loadItems();await loadStats();
  }catch(error){setStatus($("pcCreateResult"),friendlyError(error),true);}
  finally{submit.disabled=false;}
 });
}
async function init(){
 void renderCredits();
 try{
  const {data:{user},error}=await supabase.auth.getUser();
  if(error)throw error;
  if(!user){setStatus($("pcGate"),"Sign in to access appointed Council tools. Public recognition remains visible below.");return;}
  actor=user;
  const [member,manager,lead,roleResult]=await Promise.all([
   checkedRpc("council_is_member"),
   checkedRpc("council_can_manage"),
   checkedRpc("council_has_role",{p_codes:["product_lead"]}),
   supabase.from("identity_appointments").select("role_code,status,expires_at").eq("user_id",user.id).eq("status","active").limit(15)
  ]);
  if(roleResult.error)throw roleResult.error;
  if(!member){setStatus($("pcGate"),"Your account does not have an active Council appointment. Apply as an Advisor or ask for an official appointment.");return;}
  canManage=manager;isLead=lead;
  const roles=(roleResult.data||[]).filter(r=>!r.expires_at||Date.parse(r.expires_at)>Date.now()).map(r=>ROLE_NAMES[r.role_code]).filter(Boolean);
  $("pcWelcome").textContent="Welcome to your Product Council";
  $("pcRole").textContent=roles.join(" · ")||(manager?"Council leadership":"Official Council member");
  $("pcGate").hidden=true;$("pcWorkspace").hidden=false;
  if(lead)$("pcAdminLink").hidden=false;
  managerElements();wireEvents();await loadItems();await loadStats();
 }catch(error){setStatus($("pcGate"),friendlyError(error),true);}
}
void init();
