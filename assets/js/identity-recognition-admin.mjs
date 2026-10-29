import {supabase} from "./supabase.js";
const $=id=>document.getElementById(id);
const allowedRoles=new Set(["community_advisor","community_contributor","product_advisor","product_lead"]);
const allowedAwards=new Set(["staff_pick","featured","platinum","product_contributor"]);
let actorId=null;
const trim=value=>String(value||"").trim();
function notice(id,message,error=false){
 const node=$(id);if(!node)return;
 node.textContent=message;node.dataset.state=error?"error":"ok";
}
function field(form,name){return trim(new FormData(form).get(name));}
function httpsOnly(value){
 if(!value)return null;
 const url=new URL(value);
 if(url.protocol!=="https:")throw Error("Use an HTTPS address.");
 return url.toString().slice(0,600);
}
async function findMember(value){
 const handle=trim(value).replace(/^@/,"");
 if(!/^[a-z0-9_.-]{2,70}$/i.test(handle))throw Error("Enter a valid Blipmood username.");
 const {data,error}=await supabase.from("public_profiles")
  .select("id,username").eq("username",handle).maybeSingle();
 if(error)throw error;
 if(!data?.id)throw Error("No member found for @"+handle);
 return data.id;
}
async function request(form,task){
 const id=form.id+"Status",submit=form.querySelector('[type="submit"]');
 submit.disabled=true;notice(id,"Saving securely…");
 try{
   await task();
   notice(id,"Saved successfully. The change is server-validated and audited.");
   form.reset();
   await refreshOrganizations();
 }catch(error){notice(id,error.message||"Could not save. No additional action taken.",true);}
 finally{submit.disabled=false;}
}
async function refreshOrganizations(){
 const {data,error}=await supabase.from("identity_organizations")
   .select("id,name,status").order("created_at",{ascending:false}).limit(100);
 if(error)throw error;
 for(const [id,subset] of [
  ["organizationReviewSelect",data||[]],
  ["organizationAffiliateSelect",(data||[]).filter(o=>o.status==="verified")]
 ]){
   const select=$(id);select.replaceChildren();
   const placeholder=new Option("Choose organization","");placeholder.disabled=true;placeholder.selected=true;
   select.add(placeholder);
   for(const org of subset)select.add(new Option(org.name+" · "+org.status,org.id));
 }
}
function attach(formId,handler){
 const form=$(formId);
 form?.addEventListener("submit",event=>{
   event.preventDefault();
   if(!form.reportValidity())return;
   void request(form,()=>handler(form));
 });
}
function item(label,description){
 const el=document.createElement("div");el.className="identity-notice";
 const title=document.createElement("strong");title.textContent=label;
 const sub=document.createElement("p");sub.textContent=description;
 el.append(title,sub);return el;
}
async function inspectUser(form){
 const userId=await findMember(field(form,"user"));
 const host=$("identityInspectResults");host.replaceChildren();
 const [roles,awards,affiliations,official]=await Promise.all([
   supabase.from("identity_appointments").select("id,role_code,specialty,status").eq("user_id",userId).order("granted_at",{ascending:false}).limit(30),
   supabase.from("identity_awards").select("id,award_code,reason,is_active").eq("user_id",userId).order("awarded_at",{ascending:false}).limit(30),
   supabase.from("identity_affiliations").select("id,organization_id,title,status").eq("user_id",userId).limit(30),
   supabase.from("identity_official_designations").select("id,office_title,issuer_name,status").eq("user_id",userId).limit(1)
 ]);
 if(roles.error||awards.error||affiliations.error||official.error)throw roles.error||awards.error||affiliations.error||official.error;
 const orgIds=[...new Set((affiliations.data||[]).map(a=>a.organization_id))];
 let orgNames=new Map();
 if(orgIds.length){
   const orgs=await supabase.from("identity_organizations").select("id,name").in("id",orgIds);
   if(orgs.error)throw orgs.error;
   orgNames=new Map((orgs.data||[]).map(o=>[o.id,o.name]));
 }
 let rows=0;
 function revokeRow(kind,row,label,detail,isActive){
   const element=item(label+(isActive?" · Active":" · Revoked"),detail);
   if(isActive){
     const button=document.createElement("button");button.type="button";
     button.className="btn ghost sm";button.textContent="Revoke "+label;
     button.addEventListener("click",async()=>{
       if(!window.confirm("Revoke "+label+"? This action is audited."))return;
       button.disabled=true;
       const action=kind==="role"
         ?supabase.from("identity_appointments").update({status:"revoked"}).eq("id",row.id)
         :kind==="official"
           ?supabase.from("identity_official_designations").update({status:"revoked",reviewed_by:actorId,reviewed_at:new Date().toISOString()}).eq("id",row.id)
         :kind==="affiliation"
           ?supabase.from("identity_affiliations").update({status:"revoked",accepted_at:null}).eq("id",row.id)
           :supabase.from("identity_awards").update({is_active:false}).eq("id",row.id);
       const {error}=await action;
       if(error){button.disabled=false;notice("identityInspectStatus",error.message,true);return;}
       notice("identityInspectStatus","Revocation saved and audited.");
       await inspectUser(form);
     });
     element.append(button);
   }
   host.append(element);rows++;
 }
 for(const role of roles.data||[])revokeRow("role",role,role.role_code.replaceAll("_"," "),role.specialty||"Official appointment",role.status==="active");
 for(const award of awards.data||[])revokeRow("award",award,award.award_code.replaceAll("_"," "),award.reason,award.is_active);
 for(const affiliation of affiliations.data||[])revokeRow("affiliation",affiliation,
   "Company affiliation · "+(orgNames.get(affiliation.organization_id)||"Organization"),
   affiliation.title,affiliation.status==="active");
 for(const designation of official.data||[])revokeRow("official",designation,
   "Grey government / public official",designation.office_title+" · "+designation.issuer_name,
   designation.status==="active");
 if(!rows)host.append(item("No records","This member has no appointments, awards or official affiliations."));
}

async function loadAdvisorQueue(){
 const host=$("advisorReviewQueue");if(!host)return;
 host.textContent="Loading pending Advisor applications…";
 try{
   const {data,error}=await supabase.from("identity_advisor_applications")
     .select("id,user_id,requested_role,specialty,statement,evidence_url,created_at")
     .eq("status","pending").order("created_at",{ascending:true}).limit(30);
   if(error)throw error;
   if(!data?.length){host.textContent="There are no pending Advisor applications.";return;}
   const ids=[...new Set(data.map(x=>x.user_id))];
   const users=await supabase.from("public_profiles").select("id,username").in("id",ids);
   if(users.error)throw users.error;
   const handles=new Map((users.data||[]).map(x=>[x.id,x.username]));
   host.replaceChildren();
   for(const app of data){
     const card=item((handles.has(app.user_id)?"@"+handles.get(app.user_id):"Applicant")+
       " · "+app.requested_role.replaceAll("_"," "),
       "Specialization: "+app.specialty);
     const statement=document.createElement("p");
     statement.textContent=app.statement;card.append(statement);
     if(app.evidence_url){
       const link=document.createElement("a");link.href=app.evidence_url;
       link.target="_blank";link.rel="noopener noreferrer";
       link.textContent="Open applicant evidence";card.append(link);
     }
     const reason=document.createElement("textarea");
     reason.placeholder="Review rationale (25 characters minimum)";
     reason.minLength=25;reason.maxLength=1200;
     reason.setAttribute("aria-label","Private Advisor review rationale");
     card.append(reason);
     const actions=document.createElement("div");
     actions.style.display="flex";actions.style.gap="8px";actions.style.flexWrap="wrap";
     for(const [decision,label] of [["approved","Approve"],["rejected","Reject"]]){
       const button=document.createElement("button");
       button.type="button";button.className="btn "+(decision==="rejected"?"ghost":"");
       button.textContent=label;
       button.addEventListener("click",async()=>{
         const note=reason.value.trim();
         if(note.length<25){notice("advisorReviewStatus","Document the reason (25 characters minimum).",true);reason.focus();return;}
         if(!window.confirm(label+" this Advisor application? This is an audited decision."))return;
         actions.querySelectorAll("button").forEach(b=>b.disabled=true);
         notice("advisorReviewStatus","Recording reviewed decision…");
         const {error}=await supabase.rpc("review_identity_advisor",{
           p_application_id:app.id,p_decision:decision,p_review_note:note
         });
         if(error){
           actions.querySelectorAll("button").forEach(b=>b.disabled=false);
           notice("advisorReviewStatus","Review failed: "+error.message,true);return;
         }
         notice("advisorReviewStatus","Advisor review recorded successfully.");
         await loadAdvisorQueue();
       });
       actions.append(button);
     }
     card.append(actions);host.append(card);
   }
 }catch(error){
   host.textContent="Unable to load Advisor applications.";
   notice("advisorReviewStatus",error.message||"Please retry.",true);
 }
}
async function initialize(){
 const {data:{user},error:authError}=await supabase.auth.getUser();
 if(authError||!user){$("identityGate").textContent="Please sign in to manage identity records.";return;}
 const {data:allowed,error:roleError}=await supabase.rpc("has_role_secure",{p_role:"super"});
 if(roleError||allowed!==true){$("identityGate").textContent="Only a verified Blipmood super administrator can access these controls.";return;}
 actorId=user.id;
 $("identityWorkspace").hidden=false;
 $("identityGate").textContent="Super-administrator access confirmed · changes are audited.";
 try{await refreshOrganizations();}catch(error){$("identityGate").textContent="Access confirmed; could not load organizations: "+error.message;}
 attach("orgCreate",async form=>{
   const owner=await findMember(field(form,"owner"));
   const name=field(form,"name");
   if(name.length<2||name.length>120)throw Error("Name must be 2–120 characters.");
   const {error}=await supabase.from("identity_organizations").insert({
     owner_user_id:owner,name,status:"pending",
     website:httpsOnly(field(form,"website")),logo_url:httpsOnly(field(form,"logo")),
     summary:field(form,"summary").slice(0,300)||null
   });
   if(error)throw error;
 });
 attach("orgReview",async form=>{
   const decision=field(form,"decision"),reason=field(form,"reason");
   if(!["verified","revoked"].includes(decision)||reason.length<25)throw Error("A documented review rationale of at least 25 characters is required.");
   if(!window.confirm("Record this audited "+decision+" decision?"))throw Error("Decision cancelled.");
   const {error}=await supabase.rpc("review_identity_organization",{
      p_organization_id:field(form,"organization"),p_decision:decision,p_reason:reason
   });
   if(error)throw error;
 });
 attach("affiliateCreate",async form=>{
   const user_id=await findMember(field(form,"user"));
   const organization_id=field(form,"organization"),title=field(form,"title");
   if(title.length<2||title.length>90)throw Error("Specify a position between 2 and 90 characters.");
   const {data:existing,error:lookupError}=await supabase.from("identity_affiliations")
     .select("id,status").eq("user_id",user_id).eq("organization_id",organization_id).maybeSingle();
   if(lookupError)throw lookupError;
   if(existing?.status==="active")throw Error("This member already has an active affiliation.");
   const query=existing
    ?supabase.from("identity_affiliations").update({title,status:"pending",accepted_at:null}).eq("id",existing.id)
    :supabase.from("identity_affiliations").insert({user_id,organization_id,title,status:"pending"});
   const {error}=await query;
   if(error)throw error;
 });
 attach("appointmentCreate",async form=>{
   const user_id=await findMember(field(form,"user")),role_code=field(form,"role");
   if(!allowedRoles.has(role_code))throw Error("Unsupported appointment.");
   const summary=field(form,"summary");
   if(summary.length<20)throw Error("Provide a public appointment explanation of at least 20 characters.");
   const {error}=await supabase.from("identity_appointments").upsert({
     user_id,role_code,specialty:field(form,"specialty").slice(0,100)||null,
     summary,status:"active",granted_by:actorId,granted_at:new Date().toISOString()
   },{onConflict:"user_id,role_code"});
   if(error)throw error;
 });
 attach("awardCreate",async form=>{
   const user_id=await findMember(field(form,"user")),award_code=field(form,"award");
   if(!allowedAwards.has(award_code))throw Error("Unsupported recognition.");
   const reason=field(form,"reason");
   if(reason.length<15)throw Error("Write a meaningful award justification.");
   const expires=field(form,"expires");
   const expires_at=expires?new Date(expires+"T23:59:59Z").toISOString():null;
   if(expires_at&&new Date(expires_at)<=new Date())throw Error("Expiration must be in the future.");
   const {error}=await supabase.from("identity_awards").insert({
     user_id,award_code,reason,source_url:httpsOnly(field(form,"source")),
     expires_at,granted_by:actorId
   });
   if(error)throw error;
 });
 attach("governmentCreate",async form=>{
   const user_id=await findMember(field(form,"user"));
   const office_title=field(form,"office"),issuer_name=field(form,"issuer"),evidence_note=field(form,"evidence");
   if(office_title.length<4||issuer_name.length<4||evidence_note.length<50)
     throw Error("Provide a verified office, issuing institution and at least 50 characters of evidence.");
   const {data:profile,error:profileError}=await supabase.from("public_profiles")
     .select("is_verified,verification_expires_at").eq("id",user_id).maybeSingle();
   if(profileError)throw profileError;
   if(!profile?.is_verified || (profile.verification_expires_at&&new Date(profile.verification_expires_at)<=new Date()))
     throw Error("This account must pass individual identity review before an official Grey designation.");
   if(!window.confirm("You confirm this government/public office was checked against reliable official evidence?"))
     throw Error("Official verification was cancelled.");
   const {error}=await supabase.from("identity_official_designations").upsert({
     user_id,office_title,issuer_name,evidence_note,reviewed_by:actorId,
     reviewed_at:new Date().toISOString(),status:"active"
   },{onConflict:"user_id"});
   if(error)throw error;
 });
 attach("identityInspect",inspectUser);
 $("refreshAdvisorQueue")?.addEventListener("click",()=>void loadAdvisorQueue());
 void loadAdvisorQueue();
}
initialize().catch(error=>{notice("identityGate",error.message||"Identity tools could not be loaded.",true);});
