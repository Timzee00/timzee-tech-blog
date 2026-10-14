// Bounded news selection. This is a transparent heuristic, NOT a verified
// social-media trending score. Popularity is unknown unless a source supplies
// trusted audience metrics. Prefer recent, original, information-rich stories.
const interestAreas = [
  ["ai","AI",/\b(ai|llm|agentic|neural|machine learning|model release|open weights|reasoning model)\b/i],
  ["builders","Indie builders",/\b(open source|open-source|github|indie hack|side project|clone|build in public|solo developer|developer tool|app launch)\b/i],
  ["security","Security",/\b(vulnerabilit|breach|ransomware|cybersecurity|security patch|zero.day|malware|exploit)\b/i],
  ["software","Software",/\b(browser|operating system|windows|linux|android|ios|framework|typescript|python|javascript|cloud|database)\b/i],
  ["business","Startups and business",/\b(startup|funding|acquisition|founder|business|regulation|privacy|antitrust|jobs|creator economy)\b/i],
  ["science","Technology and science",/\b(robotic|quantum|satellite|space|chip|semiconductor|electric vehicle|battery|research)\b/i]
];
function topicFor(item){
  const haystack=[item.title, ...(Array.isArray(item.tags)?item.tags:[])].join(" ").slice(0,1200);
  return interestAreas.find(([, , re])=>re.test(haystack))?.[0]||"other";
}
function publishedMillis(value){
  const ms=Date.parse(String(value||""));
  return Number.isFinite(ms)?ms:0;
}
function newsScore(item,now=Date.now()){
  const published=publishedMillis(item.published_at);
  const ageHours=published>0?Math.max(0,(now-published)/3600000):720;
  const freshness=ageHours<=12?45:ageHours<=24?36:ageHours<=48?26:ageHours<=96?14:ageHours<=168?5:-22;
  const summary=String(item.summary||"").replace(/<[^>]*>/g," ").trim();
  const info=Math.min(18,Math.round(summary.length/110));
  const title=String(item.title||"").trim();
  const titleQuality=title.length>=24&&title.length<=150?12:0;
  const relevance=topicFor(item)==="other"?0:17;
  const special=/\b(released|announced|launch|discovered|built|open.source|security|research|investigation|breakthrough|new)\b/i.test(title)?8:0;
  return freshness+info+titleQuality+relevance+special;
}
function rankScoutItems(items,{now=Date.now(),limit=30,maxPerTopic=8}={}){
  const seen=new Set(), counts=new Map(), result=[];
  const sorted=[...(items||[])].filter(item=>{
    if(!item?.title||!item?.link) return false;
    const published=publishedMillis(item.published_at);
    // The trending queue is fresh news, not an archive. Missing or future
    // dates may indicate malformed metadata; allow slight clock drift only.
    const age=now-published;
    return published>0 && age>=-3600000 && age<=7*86400000;
  })
    .map((item,index)=>({...item,__newsScore:newsScore(item,now),__rankIndex:index}))
    .sort((a,b)=>b.__newsScore-a.__newsScore || a.__rankIndex-b.__rankIndex);
  for(const item of sorted){
    const titleKey=String(item.title).toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
    if(!titleKey||seen.has(titleKey))continue;
    const topic=topicFor(item);
    if((counts.get(topic)||0)>=maxPerTopic)continue;
    seen.add(titleKey);counts.set(topic,(counts.get(topic)||0)+1);
    result.push(item);
    if(result.length>=limit)break;
  }
  return result;
}
module.exports={newsScore,rankScoutItems,topicFor};
