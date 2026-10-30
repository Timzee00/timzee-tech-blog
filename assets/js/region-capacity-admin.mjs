import {supabase} from "./supabase.js";
const $=id=>document.getElementById(id);
const approvedFeatures=new Set(["video_uploads","fyp_recommendations","marketplace","live_spaces","profile_fx","creator_monetization"]);
const validCountry=c=>c==="*"||/^[A-Z]{2}$/.test(c);
const sizeMB=b=>(Number(b||0)/1048576);
const pretty=b=>sizeMB(b)>=1024?(sizeMB(b)/1024).toFixed(2)+" GB":sizeMB(b).toFixed(1)+" MB";
const text=(id,value,error=false)=>{const el=$(id);if(el){el.textContent=value;el.dataset.error=String(error);}};
let actor=null,rules=[];
function sanitizeCountry(value){return String(value||"").trim().toUpperCase();}
function iso(input){return input?new Date(input).toISOString():null;}
async function loadRules(){
 const {data,error}=await supabase.from("platform_feature_rules")
  .select("feature_key,country_code,enabled,rollout_pct,starts_at,ends_at")
  .order("feature_key",{ascending:true}).order("country_code",{ascending:true}).limit(150);
 if(error)throw error;
 rules=data||[];showRule();
}
function localDate(value){
 if(!value)return "";
 const d=new Date(value);
 const local=new Date(d.getTime()-d.getTimezoneOffset()*60000);
 return local.toISOString().slice(0,16);
}
function showRule(){
 const feature=$("rgFeature").value,country=sanitizeCountry($("rgCountry").value);
 const rule=rules.find(x=>x.feature_key===feature&&x.country_code===country);
 const fallback=rules.find(x=>x.feature_key===feature&&x.country_code==="*");
 const displayed=rule||fallback;
 if(displayed){
  $("rgEnabled").checked=displayed.enabled;
  $("rgPercent").value=displayed.rollout_pct;
  $("rgStart").value=localDate(displayed.starts_at);
  $("rgEnd").value=localDate(displayed.ends_at);
 }
 text("rgEffective",rule?"Existing rule: "+country+
   ". Change and save to update it.":fallback?"No "+country+" override. Current global default: "+
   (fallback.enabled?"enabled":"disabled")+" at "+fallback.rollout_pct+"%.":"No configured rule.");
 $("rgRemove").disabled=country==="*";
}
async function loadCapacity(){
 text("rgCapacity","Measuring database and storage…");
 try{
  const {data,error}=await supabase.rpc("blipmood_capacity_snapshot");
  if(error)throw error;
  const host=$("rgCapacity");host.replaceChildren();host.className="rg-cap";
  const percent=Math.min(100,Math.max(0,100*(Number(data.media_bytes)||0)/Math.max(1,Number(data.media_budget_bytes)||1)));
  function line(label,value){
   const row=document.createElement("div");row.className="rg-line";
   const key=document.createElement("span");key.textContent=label;
   const val=document.createElement("strong");val.textContent=value;row.append(key,val);host.append(row);
  }
  line("PostgreSQL used",pretty(data.database_bytes));
  line("Stored media",pretty(data.media_bytes));
  line("Budget",pretty(data.media_budget_bytes));
  const meter=document.createElement("div");meter.className="rg-meter";
  const fill=document.createElement("span");fill.style.width=percent.toFixed(1)+"%";meter.append(fill);host.append(meter);
  line("Usage",percent.toFixed(1)+"%");
  const status=document.createElement("p");
  status.textContent=percent>=data.upload_pause_pct?"Upload pause threshold reached."
   :percent>=data.warning_pct?"Media storage warning threshold reached."
   :"Storage below configured warning threshold.";
  host.append(status);
  const bucketList=document.createElement("div");bucketList.className="rg-buckets";
  for(const b of (data.buckets||[])){
   const row=document.createElement("div");const label=document.createElement("span");
   label.textContent=b.name+" ("+b.files+" files)";
   const value=document.createElement("strong");value.textContent=pretty(b.bytes);
   row.append(label,value);bucketList.append(row);
  }
  host.append(bucketList);
  $("rgMaxVideo").value=Math.round(sizeMB(data.max_video_upload_bytes));
  $("rgMaxThumb").value=sizeMB(data.max_thumbnail_bytes);
  $("rgBudget").value=Math.round(sizeMB(data.media_budget_bytes));
  $("rgWarn").value=data.warning_pct;
  $("rgPause").value=data.upload_pause_pct;
 }catch(error){text("rgCapacity","Capacity snapshot unavailable: "+(error.message||"unknown error"),true);}
}
async function save(form,task,status){
 const button=form.querySelector('[type="submit"]');button.disabled=true;
 text(status,"Saving…");
 try{await task();text(status,"Saved. This change is validated and audited.");}
 catch(error){text(status,error.message||"Unable to save.",true);}
 finally{button.disabled=false;}
}
async function boot(){
 const {data:{user},error:authError}=await supabase.auth.getUser();
 if(authError||!user){text("rgGate","Sign in as a super administrator to continue.");return;}
 const {data:allowed,error}=await supabase.rpc("has_role_secure",{p_role:"super"});
 if(error||allowed!==true){text("rgGate","Access restricted to Blipmood super administrators.");return;}
 actor=user.id;$("rgWorkspace").hidden=false;
 text("rgGate","Super-administrator access confirmed. Every configuration change is audited.");
 await Promise.all([loadRules(),loadCapacity()]);
 $("rgFeature").addEventListener("change",showRule);
 $("rgCountry").addEventListener("change",()=>{$("rgCountry").value=sanitizeCountry($("rgCountry").value);showRule();});
 $("rgRuleForm").addEventListener("submit",event=>{
  event.preventDefault();const form=event.currentTarget;
  void save(form,async()=>{
   const feature=$("rgFeature").value,country=sanitizeCountry($("rgCountry").value);
   const pct=Number($("rgPercent").value);
   if(!approvedFeatures.has(feature)||!validCountry(country)||!Number.isInteger(pct)||pct<0||pct>100)throw Error("Use an allowed feature, country code and 0–100% rollout.");
   const starts_at=iso($("rgStart").value),ends_at=iso($("rgEnd").value);
   if(ends_at&&starts_at&&ends_at<=starts_at)throw Error("End time must be after start time.");
   const {error}=await supabase.from("platform_feature_rules").upsert({
    feature_key:feature,country_code:country,enabled:$("rgEnabled").checked,rollout_pct:pct,
    starts_at,ends_at,updated_at:new Date().toISOString(),updated_by:actor
   },{onConflict:"feature_key,country_code"});
   if(error)throw error;
   await loadRules();
  },"rgRuleStatus");
 });
 $("rgRemove").addEventListener("click",async()=>{
  const feature=$("rgFeature").value,country=sanitizeCountry($("rgCountry").value);
  if(country==="*"||!validCountry(country))return;
  if(!confirm("Remove "+country+" override for "+feature+"? Global settings will apply."))return;
  const {error}=await supabase.from("platform_feature_rules").delete().eq("country_code",country).eq("feature_key",feature);
  text("rgRuleStatus",error?"Unable to remove override: "+error.message:"Country override removed.",Boolean(error));
  if(!error)await loadRules();
 });
 $("rgUserCountryForm").addEventListener("submit",event=>{
  event.preventDefault();const form=event.currentTarget;
  void save(form,async()=>{
   const country_code=sanitizeCountry($("rgMemberCountry").value);
   const username=$("rgMember").value.trim().replace(/^@/,"");
   if(!/^[A-Z]{2}$/.test(country_code)||!/^[a-z0-9_.-]{2,70}$/i.test(username))throw Error("Enter a valid username and two-letter country code.");
   if(!confirm("Confirm that the account country has been reviewed using trustworthy evidence?"))throw Error("Review cancelled.");
   const member=await supabase.from("public_profiles").select("id").eq("username",username).maybeSingle();
   if(member.error)throw member.error;
   if(!member.data?.id)throw Error("No matching member.");
   const {error}=await supabase.from("platform_trusted_regions").upsert({
     user_id:member.data.id,country_code,evidence_type:$("rgEvidence").value,
     reviewed_by:actor,reviewed_at:new Date().toISOString()
   },{onConflict:"user_id"});
   if(error)throw error;
  },"rgUserStatus");
 });
 $("rgRefreshCapacity").addEventListener("click",()=>void loadCapacity());
 $("rgLimitsForm").addEventListener("submit",event=>{
  event.preventDefault();const form=event.currentTarget;
  void save(form,async()=>{
   const max_video_upload_bytes=Math.round(Number($("rgMaxVideo").value)*1048576);
   const max_thumbnail_bytes=Math.round(Number($("rgMaxThumb").value)*1048576);
   const media_budget_bytes=Math.round(Number($("rgBudget").value)*1048576);
   const warning_pct=Number($("rgWarn").value),upload_pause_pct=Number($("rgPause").value);
   if(![max_video_upload_bytes,max_thumbnail_bytes,media_budget_bytes,warning_pct,upload_pause_pct].every(Number.isFinite))
     throw Error("Invalid limits.");
   if(warning_pct>=upload_pause_pct)throw Error("The warning threshold must be below the upload pause threshold.");
   const {error}=await supabase.from("platform_capacity_settings").update({
    max_video_upload_bytes,max_thumbnail_bytes,media_budget_bytes,warning_pct,upload_pause_pct,
    updated_by:actor,updated_at:new Date().toISOString()
   }).eq("singleton",true);
   if(error)throw error;
   await loadCapacity();
  },"rgLimitsStatus");
 });
}
void boot().catch(error=>text("rgGate",error.message||"Unable to initialize admin controls.",true));