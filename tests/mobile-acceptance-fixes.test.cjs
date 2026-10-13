const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
test("chat trigger compares UUID id as text without invalid uuid = text", () => {
 const sql=readFileSync(path.join(__dirname,"../docs/sql/review-only-chat-thread-touch-fix.sql"),"utf8");
 assert.match(sql,/WHERE id::text = NEW\.thread_id/);
 assert.doesNotMatch(sql,/WHERE id = NEW\.thread_id/);
});
test("mobile article and AI conversations have readable styles",()=>{
 const css=readFileSync(path.join(__dirname,"../assets/css/mobile-acceptance-fixes.css"),"utf8");
 assert.match(css,/#postContent/);assert.match(css,/#aiChatLayout/);
 assert.match(css,/text-overflow: ellipsis/);
});
