const test=require("node:test");
const assert=require("node:assert/strict");
const {
  pickEditorialProvider,alternateEditorialProvider,editorialProviderEndpoint,editorialProviderModel
}=require("../netlify/functions/_lib/editorial-provider.cjs");
test("Automatic provider selection respects current Netlify credential availability",()=>{
 assert.equal(pickEditorialProvider("groq",{groq:"",openrouter:"ok"}),"openrouter");
 assert.equal(pickEditorialProvider("openrouter",{groq:"ok",openrouter:""}),"groq");
 assert.equal(pickEditorialProvider("openrouter",{groq:"ok",openrouter:"ok"}),"openrouter");
});
test("Fallback retries only retryable HTTP failures in automatic mode",()=>{
 assert.equal(alternateEditorialProvider("groq","auto",{openrouter:"ok"},429),"openrouter");
 assert.equal(alternateEditorialProvider("openrouter","auto",{groq:"ok"},503),"groq");
 assert.equal(alternateEditorialProvider("groq","groq",{openrouter:"ok"},429),null);
 assert.equal(alternateEditorialProvider("groq","auto",{openrouter:"ok"},400),null);
 assert.equal(alternateEditorialProvider("groq","auto",{openrouter:""},429),null);
});
test("Provider endpoints and models are fixed; never derived from client URL",()=>{
 assert.match(editorialProviderEndpoint("openrouter"),/^https:\/\/openrouter\.ai\/api\/v1/);
 assert.equal(editorialProviderModel("openrouter"),"openrouter/free");
 assert.match(editorialProviderEndpoint("groq"),/^https:\/\/api\.groq\.com\/openai\/v1/);
});
