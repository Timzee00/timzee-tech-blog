const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const html=fs.readFileSync(path.resolve(__dirname,"../super/email-operations.html"),"utf8");
test("email dashboard has useful explanations and touch-safe controls",()=>{
 for(const id of ["refresh","verifyBrevo","digestPreview","inactivityPreview","legacyRecovery","refreshReviews","metrics","reviewStatus"])
   assert.ok(html.includes('id="'+id+'"'),"missing "+id);
 assert.ok(html.includes("@media(max-width:560px)"));
 assert.ok(html.includes("Emails that need attention"));
 assert.ok(html.includes("What do the statuses mean?"));
});
test("email dashboard explains permission failures without hiding the reference code",()=>{
 assert.ok(html.includes('code==="P0001"||code==="42501"'));
 assert.ok(html.includes("This is a server issue."));
});
