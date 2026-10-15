// This remembers playback position only. It does not download or duplicate
// video files; the browser/CDN handles byte caching and HTTP range requests.
export function createReelProgressStore(storage,{ key="timzee:reel-progress", now=()=>Date.now(),capacity=40 }={}){
  const limit=Math.max(1,Math.min(80,Math.trunc(Number(capacity)||40)));
  function read(){
    try{
      const obj=JSON.parse(storage?.getItem(key)||"{}");
      return obj&&typeof obj==="object"&&!Array.isArray(obj)?obj:{};
    }catch{return {};}
  }
  function save(obj){try{storage?.setItem(key,JSON.stringify(obj));}catch{}}
  function get(id){
    if(typeof id!=="string"||!id||id.length>100)return null;
    const row=read()[id];
    if(!row||!Number.isFinite(row.seconds)||now()-row.savedAt>12*3600000)return null;
    return row.seconds;
  }
  function set(id,seconds,duration){
    if(typeof id!=="string"||!id||id.length>100)return;
    const at=Number(seconds),total=Number(duration);
    if(!Number.isFinite(at)||!Number.isFinite(total)||total<=0)return;
    const data=read();
    if(at<3||at>=total-3){delete data[id];}
    else data[id]={seconds:Math.floor(at),savedAt:now()};
    const sorted=Object.entries(data).filter(([,v])=>v&&Number.isFinite(v.savedAt))
      .sort((a,b)=>b[1].savedAt-a[1].savedAt).slice(0,limit);
    save(Object.fromEntries(sorted));
  }
  function remove(id){const data=read();delete data[id];save(data);}
  return {get,set,remove};
}
