/* Explainable, finite first-party recommendations. Uses existing posts
 * and the topics the member explicitly chose; no AI API and no hidden boosts. */
const TOPIC_TERMS=Object.freeze({
  "AI & ML":["ai","machine learning","artificial intelligence","ml"],
  "Programming":["programming","javascript","python","web development","coding","developer"],
  "Gadgets":["gadgets","hardware","smartphone","devices","laptop"],
  "Cybersecurity":["cybersecurity","security","privacy","encryption"],
  "Tech Jobs":["jobs","career","internship","hiring","remote work"],
  "Gaming":["gaming","games","esports"],
  "Startups":["startups","founders","entrepreneurship","startup"],
  "Learning":["tutorial","learning","course","study","guide"],
  "Technology":["technology","tech","innovation"],
  "Project Showcase":["project","portfolio","build","showcase"],
  "Sports":["sports","football","basketball"],
  "Entertainment":["entertainment","movies","music"],
  "World Affairs":["world affairs","world news","global"],
  "General":["general","community"]
});
const normalize=value=>String(value||"").toLowerCase()
  .normalize("NFKC").replace(/[^a-z0-9]+/g," ").trim();
const containsPhrase=(haystack,phrase)=>(" "+haystack+" ").includes(" "+phrase+" ");
const clamp=value=>Math.max(1,Math.min(6,Math.trunc(Number(value)||4)));
export function recommendForInterests(posts,interests,categories=[],excluded=[],limit=4){
  const selected=[...new Set((Array.isArray(interests)?interests:[])
    .filter(topic=>Object.prototype.hasOwnProperty.call(TOPIC_TERMS,topic)))].slice(0,14);
  if(!selected.length)return [];
  const categoryNames=new Map((categories||[]).map(category=>
    [category.id,normalize(category.name)]));
  const skip=new Set(excluded);
  const ranked=[];
  for(const post of (Array.isArray(posts)?posts:[]).slice(0,60)){
    if(!post?.id||skip.has(post.id)||String(post.status||"published").toLowerCase()!=="published")continue;
    if(post.publish_at){
      const raw=String(post.publish_at).trim().replace(" ","T");
      const hasOffset=raw.toUpperCase().endsWith("Z")||raw.includes("+",10)||raw.includes("-",10);
      const timestamp=Date.parse(hasOffset?raw:raw+"Z");
      if(!Number.isFinite(timestamp)||timestamp>Date.now())continue;
    }
    const tags=(Array.isArray(post.tags)?post.tags:[]).slice(0,30).map(normalize);
    const title=normalize(post.title);
    const category=categoryNames.get(post.category_id)||"";
    let score=0;
    for(const topic of selected){
      const terms=TOPIC_TERMS[topic];
      if(terms.some(term=>tags.some(tag=>tag===term||containsPhrase(tag,term))))score+=5;
      if(terms.some(term=>containsPhrase(category,term)))score+=4;
      if(terms.some(term=>containsPhrase(title,term)))score+=2;
    }
    if(score>0)ranked.push({post,score});
  }
  ranked.sort((a,b)=>b.score-a.score||
    (Date.parse(b.post.created_at||"")||0)-(Date.parse(a.post.created_at||"")||0));
  return ranked.slice(0,clamp(limit)).map(item=>item.post);
}
