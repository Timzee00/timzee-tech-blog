const test=require("node:test");
const assert=require("node:assert/strict");
const helpers=import("../assets/js/mention-text.mjs");
test("mentions reject email domains and malformed combined handles",async()=>{
 const {collectMentionHandles}=await helpers;
 assert.deepEqual(collectMentionHandles("Email admin@example.com then @Tima, @tima and @alice_7."),
   ["tima","alice_7"]);
 assert.deepEqual(collectMentionHandles("hello@domain.com"),[]);
 assert.deepEqual(collectMentionHandles("hey @name@other"),[]);
});
test("mention links are escaped and safe for plain text",async()=>{
 const {renderMentionLinks}=await helpers;
 const html=renderMentionLinks("<img src=x onerror=alert(1)> @Alice hello@domain.com");
 assert.ok(html.includes("&lt;img"));
 assert.ok(html.includes("profile.html?username=alice"));
 assert.ok(!html.includes("profile.html?username=domain"));
 assert.ok(!html.includes("<img"));
});
test("mention notification recipients are bounded",async()=>{
 const {collectMentionHandles}=await helpers;
 const text=Array.from({length:75},(_,i)=>"@user"+i).join(" ");
 assert.equal(collectMentionHandles(text).length,20);
});
