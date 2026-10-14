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
export function socialCaption(title,url,topic="news"){
  const link=trustedExternalUrl(url);if(!link)throw Error("A public URL is required.");
  return plainText(title).slice(0,160)+"\n\nRead this "+plainText(topic).slice(0,40)+" update on Timzee Tech Hub, with sources and context:\n"+link;
}
