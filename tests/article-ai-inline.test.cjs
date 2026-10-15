const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");
const context=import("../assets/js/article-ai-context.mjs");
test("article AI does not include editorial instructions as story evidence",async()=>{
 const {articleContext}=await context;
 const obj=articleContext({title:"Test",
 content:'<p class="curator-editorial-note">Do not publish</p><h2>Actual event</h2><p>Something useful happened.</p>'},"https://example.com/post?id=12#comments");
 assert.equal(obj.source,"https://example.com/post?id=12");
 assert.match(obj.text,/Actual event/);
 assert.doesNotMatch(obj.text,/Do not publish/);
});
test("every Q&A request includes article source, with bounded conversational context",async()=>{
 const {articleAiMessages}=await context;
 const source={title:"Story",source:"https://example.com/a",text:"Source evidence"};
 const history=Array.from({length:14},(_,i)=>({role:i%2?"assistant":"user",content:"comment "+i}));
 const messages=articleAiMessages(source,history,"Why is it important?");
 assert.equal(messages.length,8);
 assert.match(messages[0].content,/Source evidence/);
 assert.match(messages[0].content,/https:\/\/example.com\/a/);
 assert.equal(messages.at(-1).content,"Why is it important?");
 assert.doesNotMatch(JSON.stringify(messages),/comment 0/);
});
test("article Q&A controls and CSS remain scoped to the public post",()=>{
 const html=readFileSync(join(__dirname,"../post.html"),"utf8");
 const css=readFileSync(join(__dirname,"../assets/css/content-pages.css"),"utf8");
 const page=readFileSync(join(__dirname,"../assets/js/post.js"),"utf8");
 assert.match(html,/id="inlineArticleAi"/);
 assert.match(html,/id="articleAiQuestion"/);
 assert.match(css,/\.article-ai-panel\[hidden\]/);
 assert.match(page,/mountArticleAssistant\(post\)/);
 assert.doesNotMatch(page,/location\.assign\("ai-chat\.html\?articleContext=1"\)/);
});
