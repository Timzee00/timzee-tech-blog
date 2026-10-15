// Safe shared @mentions and #hashtag rendering; accepts plain text ONLY.
export function escapeSocial(value){
 return String(value??"").replace(/[&<>"']/g,c=>({
   "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
 }[c]));
}
export function renderSocialText(value){
 const input=String(value??"");
 const regex=/(^|[^\w@#])(#(?:topic|post):[a-f0-9-]{8,}|[@#][a-z0-9_]{1,32})(?=$|[^\w])/gi;
 let out="",offset=0,match;
 while((match=regex.exec(input))){
   const start=match.index+match[1].length,token=match[2];
   const end=start+token.length;
   out+=escapeSocial(input.slice(offset,start));
   const special=token.match(/^#(topic|post):([a-f0-9-]{8,})$/i);
   const name=token.slice(1),symbol=token[0];
   const url=special?(special[1].toLowerCase()==="topic"?"discussion.html?topic=":"post.html?id=")+
         encodeURIComponent(special[2]):
     symbol==="@"?"profile.html?username="+encodeURIComponent(name):
     "hashtags.html?tag="+encodeURIComponent(name.toLowerCase());
   out+='<a class="social-token-link" href="'+url+'" aria-label="'+
     (special?"Open reference ":symbol==="@"?"View profile ":"Explore hashtag ")+escapeSocial(name)+'">'+
     escapeSocial(token)+'</a>';
   offset=end;
 }
 return out+escapeSocial(input.slice(offset));
}
