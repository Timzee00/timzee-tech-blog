import {supabase,getCurrentUserWithRole,getUserRole} from "./supabase.js";
const $=id=>document.getElementById(id);
let staff=null;
async function authorized(){
  staff=await getCurrentUserWithRole();
  if(!staff||!["admin","super"].includes(getUserRole(staff))){
    document.querySelector("main").textContent="Administrator access required.";
    return false;
  }
  return true;
}
async function request(body){
 const session=await supabase.auth.getSession();
 const token=session.data?.session?.access_token;
 if(!token)throw Error("Session expired. Sign in again.");
 const response=await fetch("/.netlify/functions/manage-account-restrictions",{
  method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
  body:JSON.stringify(body),cache:"no-store"
 });
 const data=await response.json().catch(()=>({}));
 if(!response.ok)throw Error(data.error||"Restriction request failed.");
 return data;
}
function text(tag,value){const e=document.createElement(tag);e.textContent=String(value??"");return e;}
async function load(){
 const userId=$("targetId").value.trim(),target=$("records");target.replaceChildren(text("p","Loading..."));
 try{
  const data=await request({action:"list",userId});target.replaceChildren();
  if(!data.records?.length){target.append(text("p","No recorded restrictions."));return;}
  for(const entry of data.records){
   const card=document.createElement("div");card.className="form-card";
   card.append(text("h3",entry.scope+" · "+entry.status),text("p",entry.reason_code+" — "+entry.explanation),text("p","Ends "+new Date(entry.expires_at).toLocaleString()));
   if(entry.status==="active"){
    const b=text("button","Revoke");b.className="btn ghost";b.type="button";
    b.addEventListener("click",async()=>{
     const note=window.prompt("Reason for revoking this restriction:");
     if(!note)return;
     b.disabled=true;
     try{await request({action:"revoke",id:entry.id,note});await load();}
     catch(err){$("result").textContent=err.message;b.disabled=false;}
    });card.append(b);
   }
   target.append(card);
  }
 }catch(err){target.replaceChildren(text("p",err.message));}
}
const lookup=$("memberSearch");
const results=$("memberSearchResults");
let lookupVersion=0;
let lookupTimer=null;
function selectMember(member){
 $("targetId").value=member.id;
 $("selectedMemberHint").textContent=(member.display_name||member.username||member.email||"Member")+" selected. You can review this account's restrictions.";
 results.replaceChildren();
 void load();
}
function showMatches(rows){
 results.replaceChildren();
 for(const member of rows){
   const button=document.createElement("button");
   button.type="button";button.setAttribute("role","option");
   const name=text("strong",member.display_name||member.username||"Member");
   const detail=text("small",[member.username?"@"+member.username:"",member.email||""].filter(Boolean).join(" · "));
   button.append(name,detail);
   button.addEventListener("click",()=>selectMember(member));
   results.append(button);
 }
 if(!rows.length)results.append(text("p","No matching members found."));
}
lookup?.addEventListener("input",()=>{
 const version=++lookupVersion;
 clearTimeout(lookupTimer);
 const query=lookup.value.trim().replace(/[%,()."\\]/g,"").slice(0,60);
 results.replaceChildren();
 if(query.length<2)return;
 lookupTimer=setTimeout(async()=>{
   if(!staff)return;
   try{
     const {data,error}=await supabase.from("profiles")
       .select("id,display_name,username,email")
       .or(`display_name.ilike.%${query}%,username.ilike.%${query}%,email.ilike.%${query}%`)
       .limit(10);
     if(error)throw error;
     if(version===lookupVersion)showMatches(data||[]);
   }catch(error){if(version===lookupVersion)results.replaceChildren(text("p","Search temporarily unavailable. You can still select a user from the Users admin page."));}
 },250);
});
const preselected=new URLSearchParams(location.search).get("user")||"";
if(/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(preselected)){
  $("targetId").value=preselected;
  $("selectedMemberHint").textContent="Member selected from Users. Review or apply timed restrictions below.";
  void authorized().then(ok=>{if(ok)void load();});
}
$("lookupForm").addEventListener("submit",e=>{e.preventDefault();void load();});
$("restrictionForm").addEventListener("submit",async e=>{
 e.preventDefault();
 const button=e.submitter;
 if(!await authorized())return;
 if(!window.confirm("Apply this temporary restriction? It will block the selected user actions at the database level."))return;
 button.disabled=true;
 try{
  const res=await request({action:"restrict",userId:$("targetId").value.trim(),scope:$("scope").value,reason:$("reason").value,hours:Number($("hours").value),explanation:$("explanation").value});
  $("result").textContent="Restriction applied until "+new Date(res.restriction.expires_at).toLocaleString()+". Audit recorded: "+res.auditRecorded;
  await load();
 }catch(err){$("result").textContent=err.message;}
 finally{button.disabled=false;}
});
void authorized();