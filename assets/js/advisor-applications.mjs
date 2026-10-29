import {supabase,getCurrentUser} from "./supabase.js";
import "./nav.js";

const $=id=>document.getElementById(id);
const allowed=new Set(["community_advisor","product_advisor"]);
let currentUser=null;
function status(id,message,isError=false){const el=$(id);if(!el)return;el.textContent=message;el.dataset.error=String(isError);}
function shortDate(value){
 if(!value||Number.isNaN(Date.parse(value)))return "Date unavailable";
 return new Date(value).toLocaleDateString(undefined,{day:"numeric",month:"short",year:"numeric"});
}
async function refreshHistory(){
 if(!currentUser)return;
 const {data,error}=await supabase.from("identity_advisor_applications")
   .select("requested_role,specialty,status,review_note,created_at,reviewed_at")
   .eq("user_id",currentUser.id).order("created_at",{ascending:false}).limit(20);
 if(error)throw error;
 const host=$("advisorHistory");host.replaceChildren();
 if(!data?.length){host.textContent="No applications yet.";return;}
 for(const app of data){
   const item=document.createElement("article");
   const label=document.createElement("strong");
   label.textContent=app.requested_role.replaceAll("_"," ")+" · "+app.status;
   const description=document.createElement("p");
   description.textContent=app.specialty+" · Applied "+shortDate(app.created_at);
   item.append(label,description);
   if(app.review_note&&app.status!=="pending"){
     const note=document.createElement("p");
     note.textContent="Staff feedback: "+app.review_note;
     item.append(note);
   }
   host.append(item);
 }
 const pendingRoles=new Set(data.filter(a=>a.status==="pending").map(a=>a.requested_role));
 const select=$("advisorApplyForm")?.elements.namedItem("role");
 if(select)for(const option of select.options)option.disabled=pendingRoles.has(option.value);
 const valid=Array.from(select?.options||[]).find(o=>!o.disabled);
 if(select&&valid)select.value=valid.value;
 $("advisorApplyForm").hidden=!valid;
 if(!valid)status("advisorGate","Both Advisor pathways have applications under review.");
 else status("advisorGate","Applications are open. Your current submissions are listed on the right.");
}
async function initialize(){
 try{
   currentUser=await getCurrentUser();
   if(!currentUser){
     $("advisorGate").replaceChildren();
     const message=document.createElement("span");
     message.textContent="Sign in to apply. ";
     const link=document.createElement("a");
     link.href="login.html?next=advisor.html";link.textContent="Go to sign in";
     $("advisorGate").append(message,link);
     $("advisorHistory").textContent="Sign in to see your application history.";
     return;
   }
   await refreshHistory();
 }catch(error){
   status("advisorGate","Account or application service temporarily unavailable.",true);
   $("advisorHistory").textContent="Could not load applications.";
 }
}
$("advisorApplyForm")?.addEventListener("submit",async event=>{
 event.preventDefault();
 if(!currentUser)return;
 const form=event.currentTarget;
 if(!form.reportValidity())return;
 const fd=new FormData(form);
 const requested_role=String(fd.get("role")||"");
 const specialty=String(fd.get("specialty")||"").trim();
 const statement=String(fd.get("statement")||"").trim();
 const evidence=String(fd.get("evidence")||"").trim();
 if(!allowed.has(requested_role)||specialty.length<3||statement.length<80){status("advisorFeedback","Please complete the required fields.",true);return;}
 let evidence_url=null;
 if(evidence){try{const u=new URL(evidence);if(u.protocol!=="https:")throw Error();evidence_url=u.toString();}catch{status("advisorFeedback","Evidence URL must start with https://",true);return;}}
 const button=$("advisorSubmit");button.disabled=true;
 status("advisorFeedback","Submitting your application securely…");
 try{
   const {error}=await supabase.from("identity_advisor_applications").insert({
     user_id:currentUser.id,requested_role,specialty,statement,evidence_url,status:"pending"
   });
   if(error)throw error;
   form.reset();
   status("advisorFeedback","Application submitted successfully. Staff will review the evidence before making a decision.");
   await refreshHistory();
 }catch(error){
   status("advisorFeedback",error.code==="23505"
      ?"An application for this Advisor pathway is already pending."
      :"Unable to submit your application: "+(error.message||"please retry."),true);
 }finally{button.disabled=false;}
});
void initialize();
