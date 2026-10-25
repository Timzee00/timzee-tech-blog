const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const read=file=>fs.readFileSync(path.join(__dirname,"..",file),"utf8");
test("message menu persists a message report through one audited API",()=>{
 const src=read("assets/js/chat-context-menu.js");
 assert.match(src,/contentType:"direct_message"/);
 assert.match(src,/submitModerationReport/);
});
test("profiles and chat submit account/group reports, not contact redirects",()=>{
 const profile=read("assets/js/profile.js");
 const chat=read("assets/js/chat-v2.js");
 assert.match(profile,/Report user/);
 assert.match(profile,/contentType:"user"/);
 assert.match(chat,/contentType:group\?"chat_group":"user"/);
 assert.doesNotMatch(chat,/contact\.html\?subject=.*Chat report/);
});
test("only bounded reasons and exact identifiers enter the moderation queue",()=>{
 const helper=read("assets/js/moderation-reports.mjs");
 assert.match(helper,/description\.length<8\|\|description\.length>500/);
 assert.match(helper,/new Set\(\["user","direct_message","chat_group"\]\)/);
 assert.match(helper,/reporter_id:reporterId/);
 assert.doesNotMatch(helper,/message_body|messageText|chat_content/);
});

test("investigator provides safe context links without exposing private DMs",()=>{
 const read=require("node:fs").readFileSync;
 const file=require("node:path").resolve(__dirname,"../assets/js/moderation-case-ui.mjs");
 const code=read(file,"utf8");
 assert.match(code,/Review reported account profile/);
 assert.match(code,/View public article context/);
 assert.match(code,/Private DMs stay inside staff-only investigation/);
 assert.match(code,/details\.subjectId&&uuid\.test\(details\.subjectId\)/);
 assert.match(code,/volume alone does not prove guilt/);
});
