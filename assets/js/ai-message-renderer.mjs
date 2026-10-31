// Safe renderer for assistant Markdown. No model-supplied HTML is executed.
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node};
function inline(node,input){
 const value=String(input||"");
 const tokens=/(\u2028|\*\*[^*\n]+\*\*|~~[^~\n]+~~|\*[^*\n]+\*|`[^`\n]+`|\[[^\]\n]+\]\(https?:\/\/[^\s)]+\)|https?:\/\/[^\s<>"']+)/g;
 let offset=0;
 for(const item of value.matchAll(tokens)){
  if(item.index>offset)node.append(document.createTextNode(value.slice(offset,item.index)));
  const word=item[0];
  if(word==="\u2028")node.append(el("br"));
  else if(word.startsWith("**"))node.append(el("strong",word.slice(2,-2)));
  else if(word.startsWith("~~"))node.append(el("del",word.slice(2,-2)));
  else if(word.startsWith("*"))node.append(el("em",word.slice(1,-1)));
  else if(word.startsWith("`"))node.append(el("code",word.slice(1,-1)));
  else{
   const match=/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/.exec(word);
   const rawUrl=match?.[2]||word;
   const url=match?rawUrl:rawUrl.replace(/[.,!?:;]+$/,"");
   try{
    const parsed=new URL(url);
    if(!["https:","http:"].includes(parsed.protocol)||parsed.username||parsed.password)throw Error("Unsafe URL");
    const a=el("a",match?.[1]||url);
    a.href=parsed.href;a.target="_blank";a.rel="noopener noreferrer nofollow ugc";
    node.append(a);
    if(!match&&url.length<rawUrl.length)node.append(document.createTextNode(rawUrl.slice(url.length)));
   }catch{node.append(document.createTextNode(word))}
  }
  offset=item.index+word.length;
 }
 if(offset<value.length)node.append(document.createTextNode(value.slice(offset)));
}
const rowCells=line=>line.trim().replace(/^\||\|$/g,"").split("|").map(s=>s.trim());
const tableSeparator=line=>/^\s*\|?\s*:?-{3,}:?(\s*\|\s*:?-{3,}:?)*\s*\|?\s*$/.test(line||"");
const listType=line=>/^\s*\d+[.)]\s+/.test(line)?"ol":/^\s*[-*+•]\s+/.test(line)?"ul":"";
const blockStart=line=>/^\s*(?:#{1,4}\s+|>|```|[-*+•]\s+|\d+[.)]\s+)/.test(line);
export function renderAssistantMessage(container,raw){
 const lines=String(raw||"").replace(/<br\s*\/?\s*>|&lt;br\s*\/?\s*&gt;/gi,"\u2028").replace(/\r\n?/g,"\n").split("\n").slice(0,2400);
 const body=el("div");body.className="ai-rich-content";
 let i=0;
 while(i<lines.length){
  const line=lines[i].trim();
  if(!line){i++;continue}
  if(line.startsWith("```")){
   const lang=line.slice(3,27).replace(/[^\w+-]/g,""),code=[];i++;
   while(i<lines.length&&!lines[i].trim().startsWith("```"))code.push(lines[i++]);
   if(i<lines.length)i++;
   const pre=el("pre"),element=el("code",code.join("\n"));if(lang)element.dataset.language=lang;pre.append(element);body.append(pre);continue;
  }
  if(i+1<lines.length&&line.includes("|")&&tableSeparator(lines[i+1])){
   const heads=rowCells(line);
   if(heads.length>=2&&heads.length<=12){
    const region=el("div"),table=el("table"),header=el("thead"),tr=el("tr");
    region.className="ai-table-scroll";region.tabIndex=0;region.role="region";region.setAttribute("aria-label","AI response table; scroll horizontally to read");
    for(const heading of heads){const th=el("th");inline(th,heading);tr.append(th)}
    header.append(tr);table.append(header);i+=2;
    const tbody=el("tbody");let count=0;
    while(i<lines.length&&lines[i].includes("|")&&lines[i].trim()&&count++<150){
     const r=el("tr"),values=rowCells(lines[i++]);
     heads.forEach((_,index)=>{const cell=el("td");inline(cell,values[index]||"");r.append(cell)});
     tbody.append(r);
    }
    table.append(tbody);region.append(table);body.append(region);continue;
   }
  }
  const heading=/^(#{1,4})\s+(.+)$/.exec(line);
  if(heading){const h=el("h"+Math.min(4,heading[1].length+1));inline(h,heading[2]);body.append(h);i++;continue}
  if(/^(-{3,}|\*{3,})$/.test(line)){body.append(el("hr"));i++;continue}
  if(line.startsWith(">")){
   const quote=el("blockquote");while(i<lines.length&&lines[i].trim().startsWith(">")){const p=el("p");inline(p,lines[i++].trim().replace(/^>\s?/,""));quote.append(p)}
   body.append(quote);continue;
  }
  const kind=listType(line);
  if(kind){
   const list=el(kind);let count=0;
   while(i<lines.length&&listType(lines[i].trim())===kind&&count++<150){
    const child=el("li");inline(child,lines[i++].trim().replace(/^(?:[-*+•]\s+|\d+[.)]\s+)/,""));list.append(child);
   }
   body.append(list);continue;
  }
  const paragraph=[];
  while(i<lines.length&&lines[i].trim()&&!blockStart(lines[i].trim())){
   if(i+1<lines.length&&lines[i].includes("|")&&tableSeparator(lines[i+1]))break;
   paragraph.push(lines[i++].trim());
   if(paragraph.length>=20)break;
  }
  if(paragraph.length){const p=el("p");inline(p,paragraph.join(" "));body.append(p)}
  else{const p=el("p");inline(p,lines[i++]);body.append(p)}
 }
 container.replaceChildren(body);
 return body;
}
