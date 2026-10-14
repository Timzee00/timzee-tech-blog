// Safe formatting for LLM-produced editorial drafts. Models provide text,
// never trusted HTML. The staff member must still fact-check before publishing.
const escapeHTML = value => String(value??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
function toText(value,max=1600) { return String(value||"").replace(/<[^>]*>/g," ").replace(/\s+/g," ").trim().slice(0,max); }
function normalizedArticle(response, sourceUrl,sourceName) {
  const data=typeof response==="string"?JSON.parse(response.replace(/^```(?:json)?\s*|\s*```$/gi,"").trim()):response;
  if(!data || !Array.isArray(data.sections) || data.sections.length<4 || data.sections.length>7)
    throw Error("The model did not produce a structured article.");
  const intro=toText(data.introduction,2600), conclusion=toText(data.conclusion,2400);
  if(intro.length<80 || conclusion.length<60)throw Error("The generated opening or conclusion is too short.");
  const sections=data.sections.map(s=>({
    heading:toText(s?.heading,110),
    paragraphs:Array.isArray(s?.paragraphs)?s.paragraphs.map(p=>toText(p,2600)).filter(Boolean).slice(0,4):[]
  }));
  if(sections.some(s=>!s.heading || !s.paragraphs.length || s.paragraphs.some(p=>p.length<65)))
    throw Error("The generated article has incomplete sections.");
  const contentText=[intro,...sections.flatMap(s=>s.paragraphs),conclusion].join(" ");
  const words=contentText.split(/\s+/).length;
  if(words<450 || words>1450)throw Error("The article must contain 450–1,450 words for editorial review.");
  const safeUrl=new URL(sourceUrl);
  if(!["https:","http:"].includes(safeUrl.protocol))throw Error("Invalid source URL.");
  const html=[
    '<p class="curator-editorial-note"><strong>Editorial draft:</strong> This article was assisted by AI and requires fact-checking before publication.</p>',
    "<p>"+escapeHTML(intro)+"</p>",
    ...sections.flatMap(s=>["<h2>"+escapeHTML(s.heading)+"</h2>",...s.paragraphs.map(p=>"<p>"+escapeHTML(p)+"</p>")]),
    "<h2>Conclusion</h2>","<p>"+escapeHTML(conclusion)+"</p>",
    '<p class="curator-source-credit">Based on reporting from <a rel="noopener noreferrer" target="_blank" href="'+escapeHTML(safeUrl.toString())+'">'+escapeHTML(sourceName||safeUrl.hostname)+"</a>. Read the original report for primary details.</p>"
  ].join("\n");
  const takeaways=[...new Set((Array.isArray(data.takeaways)?data.takeaways:[])
    .map(x=>toText(x,210)).filter(x=>x.length>=35&&x.length<=210))].slice(0,4);
  if(takeaways.length<2) throw Error("The article requires at least two useful independent takeaways.");
  for(const insight of takeaways) {
    if(contentText.toLowerCase().includes(insight.toLowerCase()))
      throw Error("Takeaways cannot copy article sentences verbatim.");
  }
  html.unshift('<div hidden data-timzee-takeaways="'+escapeHTML(encodeURIComponent(JSON.stringify(takeaways)))+'"></div>');
  const warnings=Array.isArray(data.verification_notes)?data.verification_notes.map(v=>toText(v,220)).filter(Boolean).slice(0,6):[];
  const excerpt=toText(data.dek || intro,240);
  const englishTitle=toText(data.headline,160);
  return {content:html,excerpt,title:englishTitle||null,wordCount:words,warnings};
}
module.exports={normalizedArticle,toText,escapeHTML};
