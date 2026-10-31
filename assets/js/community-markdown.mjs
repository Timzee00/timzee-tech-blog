// Safe Markdown: no raw HTML or arbitrary embeds.
// Use the dependency-free text escaper: Markdown never needs DOMPurify or DOM access.
// This keeps the renderer safe and testable before build-site creates vendor bundles.
import {escapeSocial as escapeHTML} from "./social-rich-text.mjs";
const tick=String.fromCharCode(96);
function formatInlineText(input){
 let encoded=escapeHTML(String(input||""));
 encoded=encoded.replace(new RegExp(tick+"([^"+tick+"<>\\n]{1,120})"+tick,"g"),"<code>$1</code>");
 encoded=encoded.replace(/\*\*([^*\n]{1,400})\*\*/g,"<strong>$1</strong>");
 encoded=encoded.replace(/(^|[^\w])\*([^*\n]{1,400})\*(?!\w)/g,"$1<em>$2</em>");
 encoded=encoded.replace(/~~([^~\n]{1,400})~~/g,"<del>$1</del>");
 return encoded;
}
function safeLink(url,label){
 try{
  const parsed=new URL(url);
  if(!["https:","http:"].includes(parsed.protocol)||parsed.username||parsed.password)return formatInlineText(label);
  return '<a rel="noopener noreferrer nofollow ugc" target="_blank" href="'+escapeHTML(parsed.href)+'">'+escapeHTML(label)+'</a>';
 }catch{return formatInlineText(label);}
}
// Both [friendly text](https://example.com) and plain https:// URLs work.
// All URL tokens are validated before they become clickable markup.
function inline(text){
 const raw=String(text||"");
 const links=/\[([^\]\n]{1,90})\]\((https?:\/\/[^\s<>()"'\]]{1,500})\)|(https?:\/\/[^\s<>()"'\]]{1,500})/g;
 let result="",previous=0;
 for(const found of raw.matchAll(links)){
  result+=formatInlineText(raw.slice(previous,found.index));
  const label=found[1],rawUrl=found[2]||found[3];
  if(label){result+=safeLink(rawUrl,label);previous=found.index+found[0].length;continue;}
  const url=rawUrl.replace(/[.,!?:;]+$/,"");
  result+=safeLink(url,url);
  result+=formatInlineText(rawUrl.slice(url.length));
  previous=found.index+found[0].length;
 }
 return result+formatInlineText(raw.slice(previous));
}
export function renderCommunityMarkdown(raw){
 const source=String(raw||"").slice(0,12000).replace(/\r\n/g,"\n");
 let inCode=false,lines=[],code=[];
 const flush=()=>{if(code.length){lines.push("<pre><code>"+escapeHTML(code.join("\n"))+"</code></pre>");code=[];}};
 for(const line of source.split("\n")){
  if(line.trim().startsWith(tick.repeat(3))){
   if(inCode){flush();inCode=false;}else inCode=true;
   continue;
  }
  if(inCode){code.push(line);continue;}
  if(/^#{1,3} /.test(line)){
   const match=line.match(/^(#{1,3}) (.*)$/);
   lines.push("<h"+match[1].length+">"+inline(match[2])+"</h"+match[1].length+">");continue;
  }
  if(/^> /.test(line)){lines.push("<blockquote>"+inline(line.slice(2))+"</blockquote>");continue;}
  if(/^[-*] /.test(line)){lines.push("<p class='forum-markdown-list'>• "+inline(line.slice(2))+"</p>");continue;}
  lines.push(line.trim()?'<p>'+inline(line)+'</p>':'<div class="forum-markdown-space"></div>');
 }
 flush();
 return lines.join("");
}
export async function insertCommunityFormatting(field,kind){
 if(!field)return;
 if(kind==="link"){
  const start=field.selectionStart,end=field.selectionEnd;
  const selected=field.value.slice(start,end).replace(/[\[\]\r\n]/g,"").trim()||"Link";
  const answer=window.appUI?.prompt?
   await window.appUI.prompt("Paste the link URL (https://…)"):
   window.prompt("Paste the link URL (https://…)", "https://");
  if(!answer)return;
  let parsed;
  try{
   parsed=new URL(String(answer).trim());
   if(!["https:","http:"].includes(parsed.protocol)||parsed.username||parsed.password)throw Error("Invalid URL");
  }catch{
   window.appUI?.toast?.("Enter a valid http or https link.",{tone:"warning"});
   return;
  }
  field.setRangeText("["+selected+"]("+parsed.href+")",start,end,"end");
  field.focus();
  field.dispatchEvent(new Event("input",{bubbles:true}));
  return;
 }
 const pair={
  bold:["**","**"],italic:["*","*"],code:[tick,tick],
  quote:["> ",""],list:["- ",""],heading:["## ",""],link:["[","](https://example.com)"]
 }[kind];
 if(!pair||!field)return;
 const start=field.selectionStart,end=field.selectionEnd;
 const chosen=field.value.slice(start,end)||({link:"link text",bold:"bold text",italic:"italic text",code:"code",heading:"Heading",quote:"Quote",list:"List item"}[kind]||"text");
 field.setRangeText(pair[0]+chosen+pair[1],start,end,"select");
 field.focus();
 field.dispatchEvent(new Event("input",{bubbles:true}));
}
