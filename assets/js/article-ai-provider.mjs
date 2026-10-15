// Client-only resolution from an authenticated boolean-only credential
// diagnostic. Never return secret material or silently replace a chosen provider.
export const ARTICLE_PROVIDERS=["groq","openrouter","openai","anthropic"];
export function resolveArticleProvider(selection="auto",configured={},preferred="groq"){
  if(selection!=="auto"){
    if(!ARTICLE_PROVIDERS.includes(selection))throw Error("Unknown AI provider.");
    if(configured[selection]!==true)throw Error(selection+" AI is not configured for this deployment.");
    return selection;
  }
  const order=[preferred,...ARTICLE_PROVIDERS].filter((value,index,items)=>items.indexOf(value)===index);
  const available=order.find(value=>ARTICLE_PROVIDERS.includes(value)&&configured[value]===true);
  if(!available)throw Error("No AI provider is configured for this deployment.");
  return available;
}
