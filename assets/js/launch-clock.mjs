/* One shared launch clock: a reached countdown is not equivalent to publication. */
export function remainingLaunchTime(value,now=Date.now()){
  const date=typeof value==="string"&&value?Date.parse(value):NaN;
  if(!Number.isFinite(date))return {running:false,label:"Launch date to be announced"};
  const remaining=date-now;
  if(remaining<=0)return {running:false,label:"Launch window reached · awaiting confirmation"};
  const total=Math.ceil(remaining/1000);
  const days=Math.floor(total/86400);
  const hours=Math.floor(total%86400/3600);
  const minutes=Math.floor(total%3600/60);
  const seconds=total%60;
  const segment=n=>String(n).padStart(2,"0");
  return {running:true,days,hours,minutes,seconds,
    label:days+"d "+segment(hours)+"h "+segment(minutes)+"m "+segment(seconds)+"s"};
}
export function featureStatusLabel(value){
  return ({
    coming_soon:"Coming soon",
    in_progress:"In progress",
    paused:"On hold",
    live:"Live now"
  })[value]||"Coming soon";
}
export function launchFeaturePath(feature){
  const path=String(feature?.target_path||"").trim();
  return /^\/[a-zA-Z0-9/_-]+\.html(?:#[a-zA-Z][a-zA-Z0-9_-]{1,63})?$/.test(path)&&!path.includes("..")
    ?path:null;
}