// Bounded news selection. This is a transparent heuristic, NOT a verified
// social-media trending score. Popularity is unknown unless a source supplies
// trusted audience metrics. Prefer recent, original, information-rich stories.
const interestAreas = [
  ["ai","AI",/\b(ai|llm|agentic|neural|machine learning|model release|open weights|reasoning model)\b/i],
  ["builders","Indie builders",/\b(open source|open-source|github|indie hack|side project|clone|build in public|solo developer|developer tool|app launch)\b/i],
  ["security","Security",/\b(vulnerabilit|breach|ransomware|cybersecurity|security patch|zero.day|malware|exploit)\b/i],
  ["software","Software",/\b(browser|operating system|windows|linux|android|ios|framework|typescript|python|javascript|cloud|database)\b/i],
  ["business","Startups and business",/\b(startup|funding|acquisition|founder|business|regulation|privacy|antitrust|jobs|creator economy)\b/i],
  ["science","Technology and science",/\b(robotic|quantum|satellite|space|chip|semiconductor|electric vehicle|battery|research)\b/i],
  ["jobs","Jobs and careers",/\b(job openings?|recruiting|now hiring|career opportunities|vacanc(?:y|ies)|remote jobs?|graduate trainee|internship|apprenticeship)\b/i],
  ["scholarships","Scholarships and grants",/\b(scholarships?|fully funded|fellowships?|research grant|studentship|tuition waivers?|study abroad)\b/i],
  ["travel","Travel and exchange",/\b(visa|travel grants?|exchange program|work abroad|digital nomad|immigration|study visa)\b/i],
  ["freebies","Free and affordable",/\b(freebies?|giveaways?|free tier|free access|open access|promo code|discount|legitimate alternatives?|free trial)\b/i],
  ["opportunities","Opportunities",/\b(applications? open|apply now|competitions?|calls? for proposals?|accelerators?|contests?|funding opportunities)\b/i],
  ["football","Football",/\b(football|soccer|premier league|champions league|transfer window|world cup|afcon|wafcon|npfl|nff|super eagles|super falcons|caf|uefa|fifa|arsenal|chelsea|manchester united|liverpool|osimhen|boniface)\b/i],
  ["sports","Sports",/\b(sports?|nba|basketball|tennis|olympics?|formula one|formula 1|f1|grand prix|athletics|boxing|wrestling|cricket|rugby|volleyball|badminton|table tennis|judo|taekwondo|golf|nfl|ufc|mma|cycling|d.tigress)\b/i],
  ["music","Music and artists",/\b(music|album|single release|grammy|afrobeats|afrobeat|concert|tour dates|artist|record label|spotify|billboard charts?)\b/i],
  ["entertainment","Entertainment and culture",/\b(celebrity|entertainment|film|movies?|nollywood|hollywood|streaming series|viral moment|pop culture)\b/i],
  ["world","World affairs",/\b(conflict|war|ceasefire|diplomacy|sanctions|humanitarian|united nations|elections?|geopolitics|military)\b/i]
];
function topicFor(item){
  const haystack=[item.title, ...(Array.isArray(item.tags)?item.tags:[]), ...(Array.isArray(item.source_tags)?item.source_tags:[])].join(" ").slice(0,1200);
  // Time-sensitive opportunity feeds must be classified ahead of generic
  // words like "AI" or "startup" in their headlines.
  const priority=["jobs","scholarships","travel","freebies","opportunities","football","sports","music","entertainment","world"];
  for(const key of priority){
    const hit=interestAreas.find(([name,,regex])=>name===key && regex.test(haystack));
    if(hit)return hit[0];
  }
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
    const opportunity=["jobs","scholarships","travel","freebies","opportunities"].includes(topicFor(item));
    // Opportunity discovery needs a longer window; publication still requires
    // checking current opening/expiry directly at the primary source.
    return published>0 && age>=-3600000 && age<=(opportunity?30:7)*86400000;
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
