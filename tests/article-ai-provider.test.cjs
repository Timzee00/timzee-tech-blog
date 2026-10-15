const test=require("node:test");
const assert=require("node:assert/strict");
async function load(){
 const {pathToFileURL}=require("node:url");const path=require("node:path");
 return import(pathToFileURL(path.resolve(__dirname,"../assets/js/article-ai-provider.mjs")).href);
}
test("Auto chooses preferred configured model and falls back when missing",async()=>{
 const {resolveArticleProvider:r}=await load();
 assert.equal(r("auto",{groq:true,openrouter:true},"openrouter"),"openrouter");
 assert.equal(r("auto",{groq:false,openrouter:true},"groq"),"openrouter");
 assert.equal(r("auto",{groq:true,openrouter:false},"openrouter"),"groq");
});
test("Explicit selection never silently sends an article to another provider",async()=>{
 const {resolveArticleProvider:r}=await load();
 assert.throws(()=>r("groq",{groq:false,openrouter:true}),/not configured/);
 assert.equal(r("openrouter",{openrouter:true,groq:true},"groq"),"openrouter");
 assert.throws(()=>r("auto",{}),/No AI provider/);
});
test("Reader includes authenticated provider diagnostic and selection",()=>{
 const fs=require("node:fs");
 const html=fs.readFileSync(require("node:path").resolve(__dirname,"../post.html"),"utf8");
 const js=fs.readFileSync(require("node:path").resolve(__dirname,"../assets/js/article-ai.mjs"),"utf8");
 assert.match(html,/id="articleAiProvider"/);
 assert.match(js,/Authorization:"Bearer "\+token/);
 assert.match(js,/resolveArticleProvider\(selection/);
});
