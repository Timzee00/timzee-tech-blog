// Editor-only presentation helpers. A syndicated image is not proof of a reuse license.
export const ROUNDUP_TOPICS=["jobs","scholarships","opportunities","freebies","travel","football","sports","music","entertainment","world","ai","security","builders","software"];
export function trustedExternalUrl(value){
  try{
    const u=new URL(String(value||"").trim());
    if(!["http:","https:"].includes(u.protocol)||!u.hostname||u.username||u.password)return "";
    if(/^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|169\.254\.\d+\.\d+|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+|.*\.local)$/i.test(u.hostname))return "";
    u.hash="";return u.toString();
  }catch{return "";}
}
export function imageUrls(input,max=6){
  const values=Array.isArray(input)?input:String(input||"").split(/[\n\r,]+/);
  return [...new Set(values.map(trustedExternalUrl).filter(Boolean))].slice(0,Math.max(0,Math.min(max,6)));
}
/** An editor can write "image URL | matching section heading | caption".
 * Plain one-URL-per-line entries continue to work. Keep editorial placement
 * metadata out of URLs and verify reuse rights separately before publication.
 */
export function parseEditorialImageRows(input,max=6){
  const values=Array.isArray(input)?input:String(input||"").split(/[\n\r]+/);
  const result=[],seen=new Set();
  for(const value of values){
    const parts=typeof value==="string"?value.split(/\s+\|\s+/):[value?.url,value?.heading,value?.caption];
    const url=trustedExternalUrl(parts[0]);
    if(!url || seen.has(url))continue;
    seen.add(url);
    result.push({
      url,
      heading:String(parts[1]||"").replace(/<[^>]*>/g,"").trim().slice(0,110),
      caption:String(parts[2]||"").replace(/<[^>]*>/g,"").trim().slice(0,220)
    });
    if(result.length>=Math.max(1,Math.min(6,max)))break;
  }
  return result;
}
export function htmlEscape(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");}
export function plainText(v){return String(v||"").replace(/<[^>]*>/g," ").replace(/&nbsp;/gi," ").replace(/\s+/g," ").trim();}
export function generateRoundupDraft(rows,topic){
  if(!ROUNDUP_TOPICS.includes(topic))throw Error("Choose a valid roundup topic.");
  if(!Array.isArray(rows)||rows.length<2||rows.length>6)throw Error("Select two to six related reports.");
  const seen=new Set(),items=[];
  for(const row of rows){
    const url=trustedExternalUrl(row?.source_url);
    if(!url||seen.has(url))throw Error("Each story needs its own valid source link.");
    seen.add(url);
    const title=plainText(row.title).slice(0,160);
    const description=plainText(row.description||row.excerpt).slice(0,1200);
    if(!title||description.length<45)throw Error("Each roundup story needs verified descriptive detail.");
    items.push({title,url,description,source:plainText(row.source_name||"Original report").slice(0,100)});
  }
  const heading=topic[0].toUpperCase()+topic.slice(1);
  const content=[
    '<p><strong>Editorial roundup draft:</strong> Verify claims, deadlines, eligibility and source links before publishing.</p>',
    ...items.flatMap((item,index)=>[
      '<h2>'+(index+1)+'. '+htmlEscape(item.title)+'</h2>',
      '<p>'+htmlEscape(item.description)+'</p>',
      '<p><strong>Original source:</strong> <a href="'+htmlEscape(item.url)+'" target="_blank" rel="noopener noreferrer">'+htmlEscape(item.source)+'</a></p>'
    ]),
    '<h2>Before you act</h2>',
    '<p>Check each official announcement and its current terms. For jobs and scholarships, apply using verified channels. For freebies, check regional eligibility, hidden charges and legal access.</p>'
  ].join("\n");
  return {title:items.length+' '+heading+' updates worth knowing',content,excerpt:'A sourced roundup of '+items.length+' '+topic+' updates. Verify each announcement before acting.',tags:[topic,"roundup"],source_url:items[0].url,source_id:rows[0].source_id,source_name:"Timzee curated roundup",image_url:rows[0].image_url||"",published_at:new Date().toISOString(),status:"draft"};
}

const ROUNDUP_SIGNALS={
  jobs:/\b(hiring|job opening|remote job|vacanc(?:y|ies)|recruit(?:ment|ing)|apply for.*role|career opportunities)\b/i,
  scholarships:/\b(scholarship|studentship|tuition funding|fully funded|study grant|bursar(?:y|ies))\b/i,
  opportunities:/\b(fellowship|internship|accelerator|grant application|competition|application deadline|training opportunity)\b/i,
  freebies:/\b(free (?:plan|tier|access|course|software|resource|trial)|giveaway|freebie|no.cost offer)\b/i,
  travel:/\b(visa|work permit|study abroad|relocation|travel opportunity|digital nomad|immigration)\b/i,
  football:/\b(football|premier league|uefa|fifa|champions league|transfer window|la liga|serie a)\b/i,
  sports:/\b(sport|basketball|nba|tennis|olympic|athlete|world cup)\b/i,
  music:/\b(music|album|single|song|singer|record label|streaming charts)\b/i,
  entertainment:/\b(celebrity|actor|movie|film|entertainment|tv series)\b/i,
  world:/\b(election|government|war|diplomacy|conflict|sanctions|foreign policy)\b/i,
  ai:/\b(artificial intelligence|machine learning|neural network|llm|ai model|ai agent)\b/i,
  security:/\b(cybersecurity|malware|vulnerability|ransomware|data breach|security patch)\b/i,
  builders:/\b(indie developer|open.source|github project|build in public|side project)\b/i,
  software:/\b(software|operating system|browser|framework|developer tooling|database)\b/i
};
export function suggestRoundupIds(rows,topic,{limit=6}={}){
  const signal=ROUNDUP_SIGNALS[topic];
  if(!signal)return [];
  const matches=[];
  for(const row of rows||[]){
    if(!trustedExternalUrl(row?.source_url)||!row?.id)continue;
    const text=[row.title,row.excerpt,row.description,...(Array.isArray(row.tags)?row.tags:[])].join(" ").slice(0,3000);
    if(signal.test(text))matches.push(row.id);
  }
  return matches.length>=2?matches.slice(0,Math.max(2,Math.min(6,limit))):[];
}

export function socialCaption(title,url,topic="news"){
  const link=trustedExternalUrl(url);if(!link)throw Error("A public URL is required.");
  return plainText(title).slice(0,160)+"\n\nRead this "+plainText(topic).slice(0,40)+" update on Timzee Tech Hub, with sources and context:\n"+link;
}


/** Place rights-approved figures after relevant H2 sections of an article.
 * Placement is evenly spaced by section, never an inference that a particular
 * photo documents a claim. Editors verify relevance and reuse permission. */
export function placeEditorialFigures(html,images,credit=""){
  const rows=(Array.isArray(images)&&images.every(v=>typeof v==="object")
    ?parseEditorialImageRows(images):Array.isArray(images)
      ?parseEditorialImageRows(images.map(x=>String(x)).join("\n"))
      :parseEditorialImageRows(images)).slice(1);
  const body=String(html||"");
  if(!rows.length)return body;
  const headings=[...body.matchAll(/<h2\b[^>]*>[\s\S]*?<\/h2\s*>/gi)];
  if(!headings.length)return body;
  const positions=rows.map((row,i)=>{
    let match=-1;
    if(row.heading){
      const sought=row.heading.toLowerCase().replace(/\s+/g," ");
      match=headings.findIndex(heading=>plainText(heading[0]).toLowerCase().includes(sought));
    }
    // If no section matches, distribute photos without claiming they document
    // facts from an unrelated passage. Editors approve every placement.
    const chosen=match>=0?match:Math.min(headings.length-1,
      Math.floor((i+1)*headings.length/(rows.length+1)));
    // Preserve readable context: introduce the section before showing its
    // illustrative figure, rather than placing every photo immediately after
    // the heading. Do not cross into the next section.
    const begin=headings[chosen].index+headings[chosen][0].length;
    const until=headings[chosen+1]?.index??body.length;
    const within=body.slice(begin,until);
    const firstParagraph=/<p\b[^>]*>[\s\S]*?<\/p\s*>/i.exec(within);
    const afterContext=firstParagraph ? begin+firstParagraph.index+firstParagraph[0].length : begin;
    return {
      position:afterContext,index:i,
      figure:'<figure class="curator-inline-image"><img loading="lazy" decoding="async" referrerpolicy="no-referrer" src="'+htmlEscape(row.url)+'" alt="'+htmlEscape(row.caption||"Article illustration "+(i+2))+'"><figcaption>'+htmlEscape(row.caption||credit||"Image used with permission")+'</figcaption></figure>'
    };
  });
  return positions.sort((a,b)=>b.position-a.position || b.index-a.index).reduce(
    (current,item)=>current.slice(0,item.position)+item.figure+current.slice(item.position),body);
}
