const test=require("node:test");
const assert=require("node:assert/strict");
const {normalizedArticle}=require("../netlify/functions/_lib/editorial-draft.cjs");
const src="https://news.example.com/report";
const paragraph="A verified report describes how the software works, who is involved, and which limitations were documented. This paragraph provides context without inventing a source fact.";
test("a long structured draft is escaped, attributed, and held for review",()=>{
 const article=normalizedArticle({
   introduction:paragraph.repeat(2),
   sections:Array.from({length:5},(_,i)=>({heading:i===0?"<script>Danger</script>Background":"What we know "+i,paragraphs:[paragraph.repeat(2)]})),
   conclusion:paragraph.repeat(2),
   verification_notes:["Confirm the scope of the announced rollout"]
 },src,"Trusted News");
 assert.ok(article.wordCount>=450);
 assert.match(article.content,/curator-editorial-note/);
 assert.match(article.content,/news\.example\.com\/report/);
 assert.doesNotMatch(article.content,/<script>/);
 assert.equal(article.warnings.length,1);
});
test("rejects a short, unsupported article instead of padding it",()=>{
 const p="A report about a project that still requires factual verification and a great deal of supporting evidence.";
 assert.throws(()=>normalizedArticle({introduction:p.repeat(2),sections:Array.from({length:4},(_,i)=>({heading:"Part "+i,paragraphs:[p]})),conclusion:p.repeat(2)},src,"News"),/450/);
});
