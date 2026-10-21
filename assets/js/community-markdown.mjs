// Safe Markdown: no raw HTML or arbitrary embeds.
import {escapeHTML} from "./utils.js";
const tick=String.fromCharCode(96);
function inline(text){
 let encoded=escapeHTML(String(text||""));
 encoded=encoded.replace(new RegExp(tick+"([^"+tick+"<>\\n]{1,120})"+tick,"g"),"<code>$1</code>");
 encoded=encoded.replace(/\*\*([^*\n]{1,400})\*\*/g,"<strong>$1</strong>");
 encoded=encoded.replace(/(^|[^\w])\*([^*\n]{1,400})\*(?!\w)/g,"$1<em>$2</em>");
 encoded=encoded.replace(/~~([^~\n]{1,400})~~/g,"<del>$1</del>");
 encoded=encoded.replace(/\[([^\]\n]{1,90})\]\((https:\/\/[^\s<>()"']{1,500})\)/g,
 (_,label,url)=>'<a rel="noopener noreferrer nofollow ugc" target="_blank" href="'+url+'">'+label+'</a>');
 return encoded;
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
export function insertCommunityFormatting(field,kind){
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
