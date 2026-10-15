// Safe shared @mentions and #hashtag rendering; accepts plain text ONLY.
export function escapeSocial(value){
 return String(value??"").replace(/[&<>"']/g,c=>({
   "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
 }[c]));
}
export function renderSocialText(value){
 const input=String(value??"");
 const regex=/(^|[^\w@#])([@#])([a-z0-9_]{1,32})(?=$|[^\w])/gi;
 let out="",offset=0,match;
 while((match=regex.exec(input))){
   const start=match.index+match[1].length;
   const end=start+match[2].length+match[3].length;
   out+=escapeSocial(input.slice(offset,start));
   const name=match[3],symbol=match[2];
   const url=symbol==="@"?"profile.html?username="+encodeURIComponent(name):
     "hashtags.html?tag="+encodeURIComponent(name.toLowerCase());
   out+='<a class="social-token-link" href="'+url+'" aria-label="'+
     (symbol==="@"?"View profile ":"Explore hashtag ")+escapeSocial(name)+'">'+
     escapeSocial(symbol+name)+'</a>';
   offset=end;
 }
 return out+escapeSocial(input.slice(offset));
}
