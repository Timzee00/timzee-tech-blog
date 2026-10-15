// Plain text only: never interpret email addresses or adjacent handles as
// mentions. Keep this shared by notifications and accessible rendering.
export const HANDLE_TOKEN=/(^|[^\w@])@([a-z0-9_]{1,32})(?![\w@])/gi;
export function collectMentionHandles(value,{limit=20}={}){
  const text=String(value||"").slice(0,12000);
  const seen=new Set(),out=[];
  for(const match of text.matchAll(HANDLE_TOKEN)){
    const handle=match[2].toLowerCase();
    if(seen.has(handle))continue;
    seen.add(handle);out.push(handle);
    if(out.length>=Math.max(1,Math.min(50,Math.trunc(limit)||20)))break;
  }
  return out;
}
const escapeHTML=value=>String(value||"").replace(/[&<>"']/g,c=>({
  "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
}[c]));
export function renderMentionLinks(value){
  const text=String(value||"");
  let out="",start=0;
  for(const match of text.matchAll(HANDLE_TOKEN)){
    const at=match.index+match[1].length,username=match[2];
    out+=escapeHTML(text.slice(start,at));
    out+='<a class="mention-link" href="profile.html?username='+
      encodeURIComponent(username.toLowerCase())+'" rel="nofollow">@'+escapeHTML(username)+'</a>';
    start=at+username.length+1;
  }
  return out+escapeHTML(text.slice(start));
}
