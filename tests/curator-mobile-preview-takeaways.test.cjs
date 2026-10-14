const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const source=name=>fs.readFileSync(path.join(__dirname,"..",name),"utf8");
const {normalizedArticle}=require("../netlify/functions/_lib/editorial-draft.cjs");
const paragraph="A documented project changes how software is delivered in a specific environment, but the original account does not independently establish its wider adoption, financial benefits, or security implications. Additional reporting is required to verify those issues.";
test("editorial takeaways are separate metadata and cannot repeat paragraphs",()=>{
 const article=normalizedArticle({
   headline:"An Independent Developer Creates a New Software Tool",
   introduction:paragraph.repeat(2),
   sections:Array.from({length:5},(_,i)=>({heading:"Section "+i,paragraphs:[paragraph.repeat(4)]})),
   conclusion:paragraph.repeat(2),
   takeaways:["Readers should assess the original project's documented limitations before assuming that it is suitable for production use.","The release gives developers an example to investigate, but independent adoption figures are not established."],
   verification_notes:["Confirm production usage figures independently."]
 },"https://example.org/project","Source publisher");
 assert.ok(article.wordCount>=450);
 assert.match(article.content,/data-timzee-takeaways=/);
 assert.equal(article.title,"An Independent Developer Creates a New Software Tool");
 assert.ok(!article.content.includes("<script>"));
});
test("duplicated takeaways are rejected instead of repeating article text",()=>{
 assert.throws(()=>normalizedArticle({
   introduction:paragraph.repeat(2),
   sections:Array.from({length:4},(_,i)=>({heading:"Section "+i,paragraphs:[paragraph.repeat(4)]})),
   conclusion:paragraph.repeat(2),
   takeaways:[paragraph, "Readers must check primary evidence before citing this project in their own work."]
 },"https://example.org/project","Publisher"),/Takeaways/);
});
test("old articles do not show first paragraph as Key Takeaways",()=>{
 const js=source("assets/js/post.js");
 assert.match(js,/data-timzee-takeaways/);
 assert.doesNotMatch(js,/if \(sentences\.length\) return sentences\.slice\(0, 3\)/);
});
test("curator preview renders locally with sanitized body and no publication action",()=>{
 const js=source("assets/js/curator-ui.js");
 assert.match(js,/data-type="post-preview"/);
 assert.match(js,/previewCuratorPost\(id\)/);
 assert.match(js,/normalizeHtml\(post\.content/);
 assert.match(js,/dialog\.showModal/);
});
test("translation includes title and English prompt",()=>{
 const src=source("netlify/functions/curator-expand-article.js");
 assert.match(src,/fluent English/);
 assert.match(src,/title:transformed\.title\|\|post\.title/);
});
