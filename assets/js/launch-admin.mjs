import {supabase} from "./supabase.js";
import {featureStatusLabel,launchFeaturePath} from "./launch-clock.mjs";

const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=String(text);
  if(cls)node.className=cls;
  return node;
};
let rows=[],editingId=null,bound=false,saving=false;
function notice(message,tone="neutral"){
  const node=$("featureManagerStatus");if(!node)return;
  node.textContent=message;node.dataset.tone=tone;
}
const localDate=value=>{
  if(!value)return "";
  const date=new Date(value);
  return Number.isFinite(date.getTime())?
    new Date(date.getTime()-date.getTimezoneOffset()*60000).toISOString().slice(0,16):"";
};
function reset(){
  editingId=null;
  $("featureForm").reset();
  $("featureSlug").disabled=false;$("featureSlug").dataset.touched="";
  $("featurePublic").checked=true;$("featureNotify").checked=true;
  $("featureSave").textContent="Create feature";
  $("featureEditHint").textContent="Create a public feature card, or leave it unpublished until you're ready.";
}
function fill(row){
  editingId=row.id;
  $("featureTitle").value=row.title||"";
  $("featureSlug").value=row.slug||"";
  $("featureSlug").disabled=true;
  $("featureDescription").value=row.description||"";
  $("featureStatus").value=row.status;
  $("featureTarget").value=row.target_path||"";
  $("featureLaunchAt").value=localDate(row.launch_at);
  $("featureAutoLaunch").checked=row.auto_launch===true;
  $("featurePublic").checked=row.is_public===true;
  $("featureNotify").checked=row.notify_enabled===true;
  $("featureSave").textContent="Save changes";
  $("featureEditHint").textContent="Editing "+row.title+". The slug stays fixed so existing reminder links remain valid.";
  $("featureForm").scrollIntoView({behavior:"smooth",block:"start"});
  $("featureTitle").focus();
}
function action(text,onClick,cls="btn ghost sm"){
  const button=el("button",text,cls);button.type="button";
  button.addEventListener("click",onClick);return button;
}
function render(){
  const list=$("featureManagerList");if(!list)return;
  list.replaceChildren();
  const search=String($("featureManagerSearch")?.value||"").trim().toLowerCase();
  const filtered=rows.filter(r=>!search||[r.title,r.slug,r.description,r.status,r.target_path].some(s=>String(s||"").toLowerCase().includes(search)));
  if(!filtered.length){list.append(el("p","No matching features. Create your first launch above.","launch-manager-note"));return;}
  for(const row of filtered){
    const item=el("article",undefined,"launch-manager-item");
    item.append(el("strong",row.title),
      el("small",featureStatusLabel(row.status)+" · "+(row.is_public?"Public":"Hidden")+
        (row.launch_at?" · "+new Date(row.launch_at).toLocaleString():" · No target date")));
    if(row.target_path)item.append(el("small","Display on: "+row.target_path));
    const buttons=el("div",undefined,"inline-actions");
    buttons.append(action("Edit",()=>fill(row)));
    if(row.status!=="live"){
      buttons.append(action("Mark live",async()=>{
        if(!window.confirm("Publish "+row.title+" as LIVE? Subscribers will be notified through the scheduled worker."))return;
        try{
          notice("Publishing feature…");
          const {data,error}=await supabase.from("feature_launches").update({status:"live",auto_launch:false})
            .eq("id",row.id).select("id").single();
          if(error||!data)throw error||new Error("Feature update was not confirmed");
          await load();notice("Feature published. Subscribed users will receive an in-app launch notification.","success");
        }catch(error){notice("Couldn't publish: "+(error.message||"Unknown error"),"error")}
      }));
    }
    if(row.is_public){
      const preview=el("a","View public card ↗","btn ghost sm");
      preview.href="/launches.html?feature="+encodeURIComponent(row.slug);
      preview.target="_blank";preview.rel="noopener noreferrer";
      buttons.append(preview);
    }
    item.append(buttons);
    list.append(item);
  }
}
async function load(){
  notice("Loading launch manager…");
  const {data,error}=await supabase.from("feature_launches")
    .select("id,slug,title,description,status,target_path,launch_at,auto_launch,is_public,notify_enabled,created_at,updated_at")
    .order("updated_at",{ascending:false}).limit(120);
  if(error)throw error;
  rows=data||[];
  render();
  notice(rows.length+" feature"+(rows.length===1?"":"s")+" loaded.");
}
async function save(event){
  event.preventDefault();
  if(saving)return;
  const title=$("featureTitle").value.trim();
  const slug=$("featureSlug").value.trim().toLowerCase();
  const description=$("featureDescription").value.trim();
  let targetPath=$("featureTarget").value.trim();
  if(targetPath==="/")targetPath="/index.html";
  const status=$("featureStatus").value;
  const launchText=$("featureLaunchAt").value;
  const launchAt=launchText?new Date(launchText):null;
  if(title.length<3||title.length>120){notice("Use a title between 3 and 120 characters.","error");return;}
  if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length>64){
    notice("Use a short slug with lowercase letters, numbers and hyphens.","error");return;
  }
  if(description.length>1200){notice("Description exceeds 1,200 characters.","error");return;}
  if(targetPath&&!launchFeaturePath({target_path:targetPath})){
    notice("Use a local page or section, e.g. /discussion.html or /index.html#suggestedPeopleSection.","error");return;
  }
  if(launchText&&!Number.isFinite(launchAt.getTime())){
    notice("Choose a valid launch date.","error");return;
  }
  const autoLaunch=$("featureAutoLaunch").checked&&status!=="live";
  if(autoLaunch&&!launchAt){notice("Auto-launch requires a countdown date.","error");return;}
  const payload={
    title,description,status,
    target_path:targetPath||null,
    launch_at:launchAt?launchAt.toISOString():null,
    auto_launch:autoLaunch,
    is_public:$("featurePublic").checked,
    notify_enabled:$("featureNotify").checked
  };
  if(!editingId)payload.slug=slug;
  saving=true;$("featureSave").disabled=true;
  notice(editingId?"Saving feature…":"Creating feature…");
  try{
    const query=editingId?
      supabase.from("feature_launches").update(payload).eq("id",editingId):
      supabase.from("feature_launches").insert(payload);
    const {data,error}=await query.select("id").single();
    if(error)throw error;
    reset();
    await load();
    notice("Saved: "+title+". "+(payload.is_public?"It's visible on the launch board.":"It remains hidden from visitors."),"success");
  }catch(error){
    const duplicate=error?.code==="23505";
    notice(duplicate?"That slug already exists. Choose another.":"Couldn't save feature: "+(error.message||"Unknown error"),"error");
  }finally{saving=false;$("featureSave").disabled=false;}
}
export function mountFeatureLaunchManager(){
  if(bound)return;
  if(!$("featureForm"))return;
  bound=true;
  $("featureForm").addEventListener("submit",event=>void save(event));
  $("featureCancel").addEventListener("click",reset);
  $("featureManagerRefresh").addEventListener("click",()=>void load().catch(e=>notice(e.message||"Unable to load features","error")));
  $("featureManagerSearch").addEventListener("input",render);
  $("featureTitle").addEventListener("input",()=>{
    if(editingId||$("featureSlug").dataset.touched)return;
    $("featureSlug").value=$("featureTitle").value.trim().toLowerCase()
      .replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,64).replace(/-+$/,"");
  });
  $("featureSlug").addEventListener("input",()=>{$("featureSlug").dataset.touched="1"});
  reset();
  void load().catch(error=>notice("Launch manager is unavailable: "+(error.message||"database error"),"error"));
}