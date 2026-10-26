// Non-blocking, permission-based invitation for existing members.
// Does not send an email or assume historic marketing permission.
const THIRTY_DAYS=30*24*60*60*1000;
function storageKey(id){return "timzee-member-email-invite-v1:"+id;}
function readState(id){try{return JSON.parse(localStorage.getItem(storageKey(id))||"{}");}catch{return {};}}
function writeState(id,value){try{localStorage.setItem(storageKey(id),JSON.stringify(value));}catch{}}
function skipPage(){return /^\/(?:admin|super|moderator)\//i.test(location.pathname) ||
 /\/(?:login|settings|unsubscribe|checkout)\.html$/i.test(location.pathname);}
function addStyles(){
  if(document.getElementById("member-email-invite-style"))return;
  const sheet=document.createElement("style");
  sheet.id="member-email-invite-style";
  sheet.textContent=[
    ".member-email-invite{max-width:1000px;margin:18px auto 25px;padding:20px 24px;display:flex;gap:20px;align-items:center;justify-content:space-between;flex-wrap:wrap;border:1px solid #98b9b3;border-radius:16px;background:var(--card-solid,#f5faf8);color:var(--ink,#15383b)}",
    ".member-email-invite h2{font-size:1.1rem;line-height:1.4;margin:0 0 6px}",
    ".member-email-invite p{font-size:.95rem;line-height:1.5;margin:0;max-width:650px}",
    ".member-email-invite .member-invite-feedback{margin-top:8px}",
    ".member-email-invite-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}",
    ".member-email-invite-actions button,.member-email-invite-actions a{font:inherit;font-size:.9rem;min-height:44px;padding:10px 13px;border-radius:9px;cursor:pointer;display:inline-flex;align-items:center;text-decoration:none}",
    ".member-email-invite-primary{border:1px solid #0f766e;background:#0f766e;color:#fff}",
    ".member-email-invite-secondary{border:1px solid currentColor;color:inherit;background:transparent}",
    ".member-email-invite-actions :focus-visible{outline:3px solid #0f766e;outline-offset:2px}",
    ".member-email-invite button:disabled{opacity:.6;cursor:wait}",
    "@media(max-width:640px){.member-email-invite{margin:12px;padding:16px}.member-email-invite-actions{width:100%}}"
  ].join("\n");
  document.head.append(sheet);
}
export async function maybeInviteReturningMember({user,supabase}){
  if(!user?.id||!supabase||skipPage()||document.visibilityState==="hidden")return;
  const joined=Date.parse(user.created_at||"");
  if(!Number.isFinite(joined)||Date.now()-joined<THIRTY_DAYS)return;
  const saved=readState(user.id);
  if(saved.never===true||Number(saved.until||0)>Date.now())return;
  const {data,error}=await supabase.from("email_notification_preferences")
    .select("inactivity_reminders").eq("user_id",user.id).maybeSingle();
  if(error||data?.inactivity_reminders===true)return;
  if(document.getElementById("member-email-invite"))return;
  if(document.readyState==="loading"){
    await new Promise(resolve=>document.addEventListener("DOMContentLoaded",resolve,{once:true}));
  }
  const main=document.querySelector("main");if(!main)return;
  addStyles();
  const aside=document.createElement("aside");aside.id="member-email-invite";
  aside.className="member-email-invite";aside.setAttribute("aria-label","Optional email check-ins");
  const text=document.createElement("div");
  const heading=document.createElement("h2");heading.textContent="Stay connected, on your terms";
  const description=document.createElement("p");
  description.textContent="Want one friendly email if you stop visiting Blipmood for 30 days? Only if you choose. Existing members are never enrolled automatically.";
  const feedback=document.createElement("p");feedback.className="member-invite-feedback";
  feedback.setAttribute("role","status");feedback.setAttribute("aria-live","polite");
  text.append(heading,description,feedback);
  const actions=document.createElement("div");actions.className="member-email-invite-actions";
  const enable=document.createElement("button");enable.type="button";
  enable.className="member-email-invite-primary";enable.textContent="Enable check-ins";
  const settings=document.createElement("a");settings.href="/settings.html#email";
  settings.className="member-email-invite-secondary";settings.textContent="Email settings";
  const later=document.createElement("button");later.type="button";
  later.className="member-email-invite-secondary";later.textContent="Not now";
  const never=document.createElement("button");never.type="button";
  never.className="member-email-invite-secondary";never.textContent="Hide on this device";
  later.addEventListener("click",()=>{writeState(user.id,{until:Date.now()+THIRTY_DAYS});aside.remove();});
  never.addEventListener("click",()=>{writeState(user.id,{never:true});aside.remove();});
  enable.addEventListener("click",async()=>{
    if(enable.disabled)return;
    enable.disabled=true;enable.textContent="Saving…";
    try{
      const response=await supabase.rpc("enable_my_inactivity_reminders");
      if(response.error||response.data!==true)throw Error("Preference save failed");
      writeState(user.id,{never:true});
      feedback.textContent="Enabled. You can disable reminders whenever you like in Email settings.";
      enable.textContent="Enabled";later.remove();never.remove();
    }catch{
      feedback.textContent="Couldn't save. Please retry or use Email settings.";
      enable.disabled=false;enable.textContent="Enable check-ins";
    }
  });
  actions.append(enable,settings,later,never);aside.append(text,actions);main.prepend(aside);
}
