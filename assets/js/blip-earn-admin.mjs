import {supabase} from "./supabase.js";
const $=id=>document.getElementById(id);
const ENDPOINT="/.netlify/functions/blip-earn";
let token=null,lastState=null;
function gate(text,error=false){const el=$("befGate");el.textContent=text;el.dataset.error=String(error);}
async function invoke(view,payload=null){
 const headers={Authorization:"Bearer "+token};
 if(payload)headers["Content-Type"]="application/json";
 const res=await fetch(ENDPOINT+(payload?"":"?view="+view),{
  method:payload?"POST":"GET",headers,
  ...(payload?{body:JSON.stringify(payload)}:{}),
  cache:"no-store"
 });
 let value={};try{value=await res.json();}catch{}
 if(!res.ok)throw Error(value.error||"Could not reach Blip Earn controls.");
 return value;
}
function render(data){
 const state=data.program||{};
 lastState=state;
 $("befActivated").textContent=Number(state.activated_members||0).toLocaleString();
 $("befRecent").textContent=Number(state.recent_signins_30d||0).toLocaleString();
 $("befAttributed").textContent=Number(data.tracking?.attributed||0).toLocaleString();
 $("befPending").textContent=Number(data.tracking?.pending||0).toLocaleString();
 $("befEnabled").checked=state.enabled===true;
 $("befTarget").value=Number(state.target_activated_members||0);
 $("befUpdated").textContent=state.updated_at
   ?"Last configured: "+new Date(state.updated_at).toLocaleString() : "No program changes recorded.";
 $("befProgramStatus").textContent=state.accepting_referrals
  ?"Accepting new referrals. No cash awards or payouts are enabled."
  :state.target_reached
  ?"Automatically paused: the verified-onboarded member target has been met. Raise the target or disable the program manually."
  :"New referrals are paused. Existing records remain intact.";
 $("befWorkspace").hidden=false;
 gate("Super Admin access confirmed. Changes to this switch are audited in the database.");
}
async function refresh(){const data=await invoke("admin");render(data);}
$("befSettingsForm").addEventListener("submit",async event=>{
 event.preventDefault();
 if(!token)return;
 const enabled=$("befEnabled").checked, target=Number($("befTarget").value),reason=$("befReason").value.trim();
 if(!Number.isSafeInteger(target)||target<0||target>10000000){
   gate("Enter a valid target between 0 and 10 million.",true);return;
 }
 if(reason.length<12||reason.length>500){gate("Explain the reason for the change (12–500 characters).",true);$("befReason").focus();return;}
 const changingFrom=lastState?.enabled===true;
 const action=enabled?"enable invitation tracking":"pause new referrals";
 if(!confirm("Confirm: "+action+". Existing referral records remain saved. This does NOT enable cash rewards or payouts.")){
  $("befEnabled").checked=changingFrom;return;
 }
 const button=$("befSave");button.disabled=true;
 gate("Saving changes securely…");
 try{
   await invoke("",{action:"admin-config",enabled,target,reason});
   $("befReason").value="";
   await refresh();
 }catch(error){gate(error.message||"Unable to save changes.",true);$("befEnabled").checked=changingFrom;}
 finally{button.disabled=false;}
});
async function boot(){
 const {data:{session},error}=await supabase.auth.getSession();
 if(error||!session?.access_token){gate("Sign in as a Super Admin before using referral controls.",true);return;}
 token=session.access_token;
 try{await refresh();}catch(error){gate(error.message||"Permission denied or the referral database is unavailable.",true);}
}
void boot().catch(error=>gate(error.message||"Unable to open founder controls.",true));
