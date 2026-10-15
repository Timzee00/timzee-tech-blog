// One bounded failover only in Automatic mode. Explicit editor selections
// never switch providers, and neither provider can supply an arbitrary URL.
function pickEditorialProvider(preferred="groq",configured={}){
 const first=preferred==="openrouter"?"openrouter":"groq";
 const other=first==="groq"?"openrouter":"groq";
 return configured[first]?first:configured[other]?other:first;
}
function alternateEditorialProvider(current,choice,configured,status){
 if(choice!=="auto"||![401,403,408,429,500,502,503,504].includes(Number(status)))return null;
 const alternate=current==="groq"?"openrouter":"groq";
 return configured[alternate]?alternate:null;
}
function editorialProviderEndpoint(provider){
 return provider==="openrouter"?"https://openrouter.ai/api/v1/chat/completions":"https://api.groq.com/openai/v1/chat/completions";
}
function editorialProviderModel(provider){
 return provider==="openrouter"?"openrouter/free":"openai/gpt-oss-20b";
}
module.exports={pickEditorialProvider,alternateEditorialProvider,editorialProviderEndpoint,editorialProviderModel};
