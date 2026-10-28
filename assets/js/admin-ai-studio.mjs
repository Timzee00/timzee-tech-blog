import {getSession} from "./supabase.js";
const $=id=>document.getElementById(id);
const button=$("aiGenerateDraft"),apply=$("aiInsertDraft"),output=$("aiDraftResult");
let generated="";
function feedback(message){const el=$("aiDraftStatus");if(el)el.textContent=message;}
button?.addEventListener("click",async()=>{
 const topic=$("aiDraftPrompt")?.value.trim()||"";
 if(topic.length<8){feedback("Describe the topic in at least eight characters.");return;}
 button.disabled=true;button.textContent="Generating…";apply.disabled=true;
 feedback("Asking the AI to prepare an editable draft…");
 try{
  const session=await getSession();
  if(!session?.access_token)throw Error("Sign in with an authorized staff account.");
  const isAnnouncement=$("aiDraftTarget").value==="announcement";
  const tone=$("aiDraftTone").value;
  const response=await fetch("/.netlify/functions/llm-proxy",{
   method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+session.access_token},
   body:JSON.stringify({
    provider:"groq",model:"openai/gpt-oss-20b",temperature:.65,max_tokens:1100,
    systemPrompt:"You are Blipmood's careful staff writing assistant. Write accurate, accessible, original copy for a community platform. Do not invent announcements, business claims, dates, stats or platform features not provided by the staff user. Never reveal private user data. Output plain text with the first line as an effective short headline, then a blank line, then the draft body. Tone: "+tone+". Target: "+(isAnnouncement?"brief public announcement":"well structured blog article")+". The staff will review before anything is published.",
    messages:[{role:"user",content:topic}]
   })
  });
  const json=await response.json().catch(()=>({}));
  if(!response.ok||!json.success)throw Error(json.error||"The writing service is unavailable.");
  generated=String(json.message||"").trim().slice(0,8000);
  if(!generated)throw Error("The AI returned an empty draft.");
  output.value=generated;apply.disabled=false;
  feedback("Draft ready. Edit it here, then select Use this draft. Nothing has been published.");
 }catch(error){feedback(error.message||"Couldn't generate the draft. Please retry.");}
 finally{button.disabled=false;button.textContent="✨ Generate draft";}
});
apply?.addEventListener("click",()=>{
 const draft=output.value.trim();if(!draft){feedback("Write or generate a draft first.");return;}
 const [heading,...rest]=draft.split(/\r?\n/);
 const headline=heading.replace(/^#+\s*/,"").slice(0,120);
 const body=rest.join("\n").trim()||headline;
 if($("aiDraftTarget").value==="announcement"){
  $("announcementTitle").value=headline;
  $("announcementMessage").value=body;
  const tab=document.querySelector('[data-tab="announcements"]');tab?.click();
  $("announcementTitle").scrollIntoView({behavior:"smooth",block:"center"});
 }else{
  $("postTitle").value=headline;
  const editor=$("postEditor");
  if(editor){editor.replaceChildren(...body.split(/\n\s*\n/).filter(Boolean).map(part=>{
    const p=document.createElement("p");p.textContent=part.trim();return p;
  }));editor.dispatchEvent(new Event("input",{bubbles:true}));}
  $("postTitle").scrollIntoView({behavior:"smooth",block:"center"});
 }
 feedback("Draft inserted for human review. Review details and press the regular Publish button when ready.");
});
