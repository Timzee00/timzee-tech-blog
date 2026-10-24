import {supabase,getCurrentUser} from "./supabase.js";
const $=id=>document.getElementById(id);
const state={user:null,workspaces:[],active:null,role:null,projects:[]};
const make=(tag,text="",className="")=>{const el=document.createElement(tag);if(text!==undefined)el.textContent=String(text);if(className)el.className=className;return el};
const notice=(message,tone="neutral")=>{const n=$("teamStatus");n.textContent=message;n.dataset.tone=tone};
const requireSuccess=result=>{if(result.error)throw result.error;return result.data};
const getForm=form=>Object.fromEntries(new FormData(form).entries());
function row(title,subtitle,buttons=[]){
 const wrapper=make("div","","studio-row");
 const summary=make("div");summary.append(make("strong",title),make("p",subtitle));
 wrapper.append(summary);
 for(const [label,cb] of buttons){const button=make("button",label,"btn ghost sm");button.type="button";button.addEventListener("click",cb);wrapper.append(button)}
 return wrapper;
}
async function load(){
 state.user=await getCurrentUser();
 $("teamSignedOut").hidden=Boolean(state.user);
 $("teamApplication").hidden=!state.user;
 if(!state.user){notice("Sign in to open your team workspaces.");return}
 await Promise.all([loadWorkspaces(),loadInvites()]);
 notice("Workspaces are private to owners and invited members. Organization verification is a separate approval.");
}
async function loadWorkspaces(){
 state.workspaces=requireSuccess(await supabase.from("team_workspaces")
 .select("id,kind,name,description,website,owner_id,created_at")
 .order("created_at",{ascending:false}).limit(50))||[];
 const list=$("teamList");list.replaceChildren();
 if(!state.workspaces.length)list.append(make("p","No teams yet. Create one above.","studio-muted"));
 for(const ws of state.workspaces){
  list.append(row(ws.name,ws.kind==="organization"?"Organization workspace":"Creator team",
  [["Open",()=>openWorkspace(ws.id)]]));
 }
 if(state.active&&state.workspaces.some(w=>w.id===state.active.id))await openWorkspace(state.active.id);
}
async function loadInvites(){
 const invites=requireSuccess(await supabase.rpc("team_pending_invites"))||[];
 $("invitedSection").hidden=!invites.length;
 $("teamInvites").replaceChildren();
 for(const invite of invites){
  $("teamInvites").append(row(invite.workspace_name||"Workspace invitation",(invite.workspace_kind||"Team")+" · "+invite.role,
  [["Accept",async()=>{try{const accepted=requireSuccess(await supabase.rpc("team_accept_invite",{p_workspace:invite.workspace_id}));
   if(!accepted)throw Error("This invitation is no longer available.");
   notice("Invitation accepted.","success");await loadInvites();await loadWorkspaces();
  }catch(e){notice(e.message,"error")}}]]));
 }
}
async function openWorkspace(id){
 const workspace=state.workspaces.find(w=>w.id===id);
 if(!workspace)return;
 state.active=workspace;$("teamDetails").hidden=false;
 $("teamTitle").textContent=workspace.name;
 $("teamDescription").textContent=(workspace.kind==="organization"?"Company / organization · Unverified until official review. ":"Creator team. ")+(workspace.description||"");
 $("teamSpaceLink").href="spaces.html?workspace="+encodeURIComponent(id);
 const isOwner=workspace.owner_id===state.user.id;
 state.role=isOwner?"owner":null;
 if(!isOwner){
  const membership=await supabase.from("team_workspace_members")
    .select("role").eq("workspace_id",id).eq("user_id",state.user.id).eq("status","active").maybeSingle();
  state.role=membership.data?.role||"viewer";
 }
 const manager=["owner","admin"].includes(state.role);
 const editor=["owner","admin","editor"].includes(state.role);
 $("teamInviteForm").hidden=!manager;
 $("teamProjectForm").hidden=!editor;
 $("teamProjectForm").elements.status.querySelector('option[value="approved"]').disabled=!manager;
 $("teamSpaceLink").textContent=editor?"Host a Space":"Explore workspace Spaces";
 $("teamInviteForm").elements.role.querySelector("option[value=admin]").disabled=!isOwner;
 $("teamSettingsForm").hidden=!isOwner;
 if(isOwner){
  const f=$("teamSettingsForm");
  f.elements.name.value=workspace.name;f.elements.website.value=workspace.website||"";
  f.elements.description.value=workspace.description||"";
 }
 await Promise.all([loadMembers(),loadProjects()]);
}
async function loadMembers(){
 const list=$("teamMembers");list.replaceChildren();
 list.append(row("Workspace owner","Full control"));
 const result=await supabase.from("team_workspace_members").select("user_id,role,status")
  .eq("workspace_id",state.active.id).limit(50);
 const members=requireSuccess(result)||[];
 const ids=members.map(m=>m.user_id);
 const profiles=ids.length?await supabase.from("public_profiles")
  .select("id,display_name,username").in("id",ids).limit(50):{data:[]};
 const names=new Map((profiles.data||[]).map(p=>[p.id,p.display_name||p.username]));
 for(const member of members){
  const owner=state.active.owner_id===state.user.id;
  const controls=owner?[["Remove",async()=>{if(!confirm("Remove this teammate?"))return;
   try{requireSuccess(await supabase.rpc("team_remove_member",{p_workspace:state.active.id,p_user:member.user_id}));
   await loadMembers();notice("Membership removed.","success")}catch(e){notice(e.message,"error")}}]]:[];
  list.append(row(names.get(member.user_id)||"Member "+member.user_id.slice(0,8),
   member.role+" · "+member.status,controls));
 }
}
async function loadProjects(){
 const records=requireSuccess(await supabase.from("team_studio_projects")
 .select("id,workspace_id,kind,title,body,status,created_by,updated_at")
 .eq("workspace_id",state.active.id).order("updated_at",{ascending:false}).limit(80))||[];
 state.projects=records;
 const list=$("teamProjectList");list.replaceChildren();
 if(!records.length)list.append(make("p","No collaborative projects yet.","studio-muted"));
 $("teamProjectPreview").hidden=true;
 const editor=["owner","admin","editor"].includes(state.role);
 const manager=["owner","admin"].includes(state.role);
 for(const project of records){
  const buttons=[["View",()=>{
    $("teamProjectPreview").hidden=false;
    $("teamPreviewTitle").textContent=project.title;
    $("teamPreviewMeta").textContent=project.kind+" · "+project.status;
    $("teamPreviewBody").textContent=project.body||"No project notes.";
    $("teamProjectPreview").scrollIntoView({behavior:"smooth",block:"nearest"});
  }]];
  if(editor){
   buttons.push(["Edit",()=>{
    const f=$("teamProjectForm");
    f.elements.id.value=project.id;f.elements.kind.value=project.kind;
    f.elements.title.value=project.title;f.elements.body.value=project.body;
    f.elements.status.value=!manager&&project.status==="approved"?"review":project.status;
    if(!manager&&project.status==="approved")
      notice("Edits to an approved project require fresh owner review.");
    f.elements.title.focus();
   }]);
   buttons.push(["Plan a Space",()=>{
    window.location.assign("spaces.html?workspace="+encodeURIComponent(state.active.id)
      +"&project="+encodeURIComponent(project.id));
   }]);
  }
  list.append(row(project.title,project.kind+" · "+project.status,buttons));
 }
}
$("createWorkspaceForm").addEventListener("submit",async event=>{
 event.preventDefault();if(!state.user)return;
 const values=getForm(event.currentTarget),button=event.submitter;button.disabled=true;
 try{
  // Avoid INSERT RETURNING: a separate read can see the newly committed
  // owner-scoped row through its membership and access policies.
  const createdId=crypto.randomUUID();
  const created=await supabase.from("team_workspaces").insert({
   id:createdId,owner_id:state.user.id,kind:values.kind,name:values.name.trim(),
   description:values.description.trim(),website:values.website.trim()||null
  });
  if(created.error)throw created.error;
  await loadWorkspaces();
  if(!state.workspaces.some(ws=>ws.id===createdId))throw Error("Workspace saved but is not visible yet. Refresh your session and check access.");
  event.currentTarget.reset();notice("Workspace created. You can now plan events and content.","success");
  await openWorkspace(createdId);
 }catch(e){notice(e.message||"Unable to create workspace.","error")}finally{button.disabled=false}
});
$("teamSettingsForm").addEventListener("submit",async event=>{
 event.preventDefault();if(!state.active||state.role!=="owner")return;
 const f=event.currentTarget,values=getForm(f),submit=event.submitter;submit.disabled=true;
 try{
  requireSuccess(await supabase.from("team_workspaces").update({
   name:values.name.trim(),description:values.description.trim(),
   website:values.website.trim()||null
  }).eq("id",state.active.id).select("id").single());
  await loadWorkspaces();notice("Workspace settings updated.","success");
 }catch(e){notice(e.message||"Could not save workspace settings.","error")}
 finally{submit.disabled=false}
});
$("teamInviteForm").addEventListener("submit",async event=>{
 event.preventDefault();if(!state.active)return;
 const values=getForm(event.currentTarget),button=event.submitter;button.disabled=true;
 try{
  const name=values.username.trim();
  if(!/^[A-Za-z0-9_.]{3,32}$/.test(name))throw Error("Enter an exact public username.");
  const person=requireSuccess(await supabase.from("public_profiles")
    .select("id,username").eq("username",name).maybeSingle());
  if(!person)throw Error("No account matches that username.");
  requireSuccess(await supabase.rpc("team_invite_member",{
   p_workspace:state.active.id,p_user:person.id,p_role:values.role
  }));
  event.currentTarget.reset();notice("Invitation created; it must be accepted by the teammate.","success");
  await loadMembers();
 }catch(e){notice(e.message||"Invitation failed.","error")}finally{button.disabled=false}
});
$("teamProjectForm").addEventListener("submit",async event=>{
 event.preventDefault();if(!state.active||!["owner","admin","editor"].includes(state.role))return;
 const v=getForm(event.currentTarget),button=event.submitter;button.disabled=true;
 try{
  const item={kind:v.kind,status:v.status,title:v.title.trim(),body:v.body};
  let response;
  if(v.id)response=await supabase.from("team_studio_projects").update(item)
   .eq("id",v.id).eq("workspace_id",state.active.id).select("id").single();
  else response=await supabase.from("team_studio_projects").insert({
   ...item,status:"draft",created_by:state.user.id,workspace_id:state.active.id
  }).select("id").single();
  const saved=requireSuccess(response);event.currentTarget.elements.id.value=saved.id;
  notice("Team project saved. This has not been published.","success");await loadProjects();
 }catch(e){notice(e.message||"Unable to save project.","error")}finally{button.disabled=false}
});
$("newTeamProject").addEventListener("click",()=>{$("teamProjectForm").reset();$("teamProjectForm").elements.id.value="";$("teamProjectForm").elements.title.focus()});
$("copyTeamProject").addEventListener("click",async()=>{
 const f=$("teamProjectForm");const value=f.elements.title.value+"\n\n"+f.elements.body.value;
 try{await navigator.clipboard.writeText(value);notice("Content copied. Publish it explicitly in the editor of your choice.","success")}
 catch{notice("Clipboard unavailable on this device.","error")}
});
load().catch(e=>notice(e.message||"Unable to load workspaces.","error"));