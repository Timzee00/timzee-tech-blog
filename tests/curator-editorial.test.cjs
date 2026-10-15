const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const {normalizedArticle}=require("../netlify/functions/_lib/editorial-draft.cjs");
const paragraph="The original report highlights a development, but further information is needed before judging its broader significance. Readers can consider how technology is adopted in practice while separating the reported details from useful background context.";
const draft={
  introduction:paragraph+" "+paragraph,dek:"Source-based explainer for editorial review.",
  sections:[
   {heading:"What the source says",paragraphs:[paragraph.repeat(2),paragraph.repeat(2)]},
   {heading:"Wider context",paragraphs:[paragraph.repeat(2),paragraph.repeat(2)]},
   {heading:"Unanswered questions",paragraphs:[paragraph.repeat(2),paragraph.repeat(2)]},
   {heading:"How readers can evaluate the claim",paragraphs:[paragraph.repeat(2),paragraph.repeat(2)]},
   {heading:"What remains uncertain",paragraphs:[paragraph.repeat(2),paragraph.repeat(2)]}
  ],conclusion:paragraph.repeat(2),
  takeaways:["The underlying reporting supports a specific development, but readers still need independent evidence about real-world adoption.","Source attribution and documented uncertainty matter more than a long article that merely repeats one claim."],
  verification_notes:["Verify timelines"]
};
test("renders source-credited long-form article with escaped sections",()=>{
 const data=normalizedArticle(JSON.stringify(draft),"https://example.org/story#section","Tech source");
 assert.ok(data.wordCount>=240);
 assert.match(data.content,/<h2>Wider context<\/h2>/);
 assert.match(data.content,/https:\/\/example.org\/story#section/);
 assert.match(data.content,/requires fact-checking before publication/);
});
test("rejects HTML injection and invalid source protocols",()=>{
 const x=structuredClone(draft);x.sections[0].heading="<script>alert(1)</script>";
 const data=normalizedArticle(x,"https://example.org/story","Source");
 assert.ok(!data.content.includes("<script>"));
 assert.ok(data.content.includes("<h2>alert(1)</h2>"));
 assert.throws(()=>normalizedArticle(draft,"javascript:alert(1)","Source"),/Invalid source URL/);
});
test("rejects undersized or missing structure",()=>{
 const x=structuredClone(draft);x.sections=x.sections.slice(0,2);
 assert.throws(()=>normalizedArticle(x,"https://example.org","Source"),/structured article/);
});
test("editorial endpoint remains an authenticated draft-only mutation",()=>{
 const code=fs.readFileSync(path.join(__dirname,"../netlify/functions/curator-expand-article.js"),"utf8");
 assert.match(code,/requireRole\(db,token,\["admin","super"\]/);
 assert.match(code,/consume_ai_rate_limit/);
 assert.match(code,/\.eq\("status","draft"\)\.eq\("is_posted",false\)/);
 assert.doesNotMatch(code,/status:\s*"published"/);
});
test("OpenRouter is exposed only as a server-side provider",()=>{
 const js=fs.readFileSync(path.join(__dirname,"../netlify/functions/llm-proxy.js"),"utf8");
 assert.match(js,/process\.env\.OPENROUTER_API_KEY/);
 assert.match(js,/https:\/\/openrouter\.ai\/api\/v1\/chat\/completions/);
});
