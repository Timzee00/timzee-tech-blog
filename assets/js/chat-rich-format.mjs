import {renderSocialText,escapeSocial} from "./social-rich-text.mjs";

// Text is always escaped before HTML is assembled. Rich formatting is
// cosmetic and available for messages authored by verified members.
export function renderChatText(raw,{verified=false}={}){
  const value=String(raw??"").slice(0,12000);
  if(!verified)return renderSocialText(value).replace(/\n/g,"<newline/>").replace(/<newline\/>/g,"<br>");
  const expression=/(\*\*([^*\n]{1,200})\*\*|__([^_\n]{1,200})__|~~([^~\n]{1,200})~~|\*([^*\n]{1,200})\*|\x60([^\x60\n]{1,200})\x60)/g;
  let output="",index=0,match;
  while((match=expression.exec(value))){
    output+=renderSocialText(value.slice(index,match.index)).replace(/\n/g,"<br>");
    const inner=escapeSocial(match[2]||match[3]||match[4]||match[5]||match[6]);
    const type=match[2]?"strong":match[3]?"u":match[4]?"s":match[5]?"em":"code";
    output+="<"+type+">"+inner+"</"+type+">";
    index=match.index+match[0].length;
  }
  return output+renderSocialText(value.slice(index)).replace(/\n/g,"<br>");
}
